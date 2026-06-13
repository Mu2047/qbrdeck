import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { getLimits, UPGRADE_MESSAGES } from '@/lib/limits'

export async function GET(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    const workspaceId = membership.workspaceId
    const plan        = membership.subscription?.plan ?? 'FREE'
    const limits      = getLimits(plan)
    const isFullAnalytics = limits.analytics === 'full'

    // ── Date range filter — full analytics only ───────────────────────────────
    const { searchParams } = new URL(req.url)
    const range    = isFullAnalytics ? (searchParams.get('range') ?? '6m') : '6m'
    const clientId = isFullAnalytics ? (searchParams.get('clientId') ?? 'all') : 'all'

    const now = new Date()
    let rangeStart: Date
    switch (range) {
      case '30d': rangeStart = new Date(now); rangeStart.setDate(now.getDate() - 30);        break
      case '90d': rangeStart = new Date(now); rangeStart.setDate(now.getDate() - 90);        break
      case '1y':  rangeStart = new Date(now); rangeStart.setFullYear(now.getFullYear() - 1); break
      case 'all': rangeStart = new Date('2020-01-01');                                        break
      default:    rangeStart = new Date(now); rangeStart.setMonth(now.getMonth() - 6);       break
    }

    // ── Client list — full analytics only ─────────────────────────────────────
    const allClients = isFullAnalytics
      ? await prisma.client.findMany({
          where:   { workspaceId },
          select:  { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : []

    // ── QBR base filter ───────────────────────────────────────────────────────
    const qbrWhere: any = {
      client:    { workspaceId },
      createdAt: { gte: rangeStart },
    }
    if (isFullAnalytics && clientId !== 'all') qbrWhere.clientId = clientId

    // ── 1. QBR activity by month (basic + full) ───────────────────────────────
    const qbrs = await prisma.qBR.findMany({
      where:   qbrWhere,
      select:  {
        id: true, createdAt: true, clientId: true,
        healthScore: true, healthStatus: true,
        quarter: true, year: true,
        rawMetrics:    isFullAnalytics ? true : false,
        scoreBreakdown: isFullAnalytics ? true : false,
        client: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    const qbrsByMonth: Record<string, number> = {}
    for (const qbr of qbrs) {
      const key = qbr.createdAt.toISOString().slice(0, 7)
      qbrsByMonth[key] = (qbrsByMonth[key] ?? 0) + 1
    }
    const qbrActivity = Object.entries(qbrsByMonth).map(([month, count]) => ({ month, count }))

    // ── 2. Average health score (basic + full) ────────────────────────────────
    const scoredQbrs     = qbrs.filter(q => q.healthScore !== null)
    const avgHealthScore = scoredQbrs.length > 0
      ? Math.round(scoredQbrs.reduce((sum, q) => sum + (q.healthScore ?? 0), 0) / scoredQbrs.length)
      : null

    const avgHealthStatus = avgHealthScore === null ? null
      : avgHealthScore >= 90 ? 'Excellent'
      : avgHealthScore >= 80 ? 'Strong'
      : avgHealthScore >= 70 ? 'Stable with Improvement Needed'
      : avgHealthScore >= 60 ? 'Needs Attention'
      : 'High Risk'

    // ── 3. Client coverage (basic + full) — always 90-day metric ─────────────
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    const coverageClients = await prisma.client.findMany({
      where:  { workspaceId },
      select: {
        id: true, name: true,
        qbrs: {
          where:  { createdAt: { gte: ninetyDaysAgo } },
          select: { id: true },
          take:   1,
        },
      },
    })

    const totalClients     = coverageClients.length
    const coveredClients   = coverageClients.filter(c => c.qbrs.length > 0).length
    const coveragePct      = totalClients > 0 ? Math.round((coveredClients / totalClients) * 100) : 0
    const uncoveredClients = coverageClients.filter(c => c.qbrs.length === 0).map(c => c.name)

    // ── 4. Health score trends — full analytics only ──────────────────────────
    let healthTrends: any[] = []

    if (isFullAnalytics) {
      const trendKey    = (q: typeof qbrs[0]) => `${q.clientId}__${q.quarter}__${q.year}`
      const trendLatest: Record<string, typeof qbrs[0]> = {}
      const trendCounts: Record<string, number>          = {}

      for (const qbr of qbrs) {
        if (qbr.healthScore === null) continue
        const key = trendKey(qbr)
        trendCounts[key] = (trendCounts[key] ?? 0) + 1
        if (!trendLatest[key] || qbr.createdAt > trendLatest[key].createdAt) {
          trendLatest[key] = qbr
        }
      }

      const trendMap: Record<string, {
        clientName: string
        points: { label: string; score: number; status: string; generatedDate: string; duplicateCount: number }[]
      }> = {}

      for (const qbr of Object.values(trendLatest)) {
        if (!trendMap[qbr.clientId]) {
          trendMap[qbr.clientId] = { clientName: qbr.client.name, points: [] }
        }
        const key = trendKey(qbr)
        trendMap[qbr.clientId].points.push({
          label:          `Q${qbr.quarter} ${qbr.year}`,
          score:          qbr.healthScore!,
          status:         qbr.healthStatus ?? 'Unknown',
          generatedDate:  qbr.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          duplicateCount: trendCounts[key],
        })
      }

      healthTrends = Object.values(trendMap).map(t => ({
        ...t,
        points: t.points.sort((a, b) => {
          const [aq, ay] = a.label.replace('Q', '').split(' ')
          const [bq, by] = b.label.replace('Q', '').split(' ')
          return Number(ay) !== Number(by) ? Number(ay) - Number(by) : Number(aq) - Number(bq)
        }),
      }))
    }

    // ── 5. Export activity — full analytics only ──────────────────────────────
    let exportActivity: any[] = []
    let totalPDF      = 0
    let totalPPTX     = 0
    let totalPackages = 0
    let totalDownloads = 0

    if (isFullAnalytics) {
      const exportWhere: any = { workspaceId, exportedAt: { gte: rangeStart } }
      if (clientId !== 'all') exportWhere.clientId = clientId

      const exportEvents = await prisma.exportEvent.findMany({
        where:   exportWhere,
        select:  { exportType: true, exportedAt: true, consumedExportCredit: true, exportPackageId: true },
        orderBy: { exportedAt: 'asc' },
      })

      const exportByMonth: Record<string, { PDF: number; PPTX: number }> = {}
      for (const ev of exportEvents) {
        const key = ev.exportedAt.toISOString().slice(0, 7)
        if (!exportByMonth[key]) exportByMonth[key] = { PDF: 0, PPTX: 0 }
        exportByMonth[key][ev.exportType]++
      }
      exportActivity = Object.entries(exportByMonth).map(([month, counts]) => ({ month, ...counts }))
      totalPDF       = exportEvents.filter(e => e.exportType === 'PDF').length
      totalPPTX      = exportEvents.filter(e => e.exportType === 'PPTX').length
      totalPackages  = exportEvents.filter(e => e.consumedExportCredit).length
      totalDownloads = exportEvents.length
    }

    // ── 6. Top risk flags — full analytics only ───────────────────────────────
    let topRiskFlags: { flag: string; count: number }[] = []

    if (isFullAnalytics) {
      const riskCounts: Record<string, number> = {}
      for (const qbr of qbrs) {
        const breakdown = (qbr as any).scoreBreakdown as Array<{ metric: string; deduction: number }> | null
        if (Array.isArray(breakdown)) {
          for (const d of breakdown) {
            if (d.deduction > 0) riskCounts[d.metric] = (riskCounts[d.metric] ?? 0) + 1
          }
          continue
        }
        const metrics = (qbr as any).rawMetrics as Record<string, unknown> | null
        if (!metrics) continue
        if (typeof metrics.uptimePct          === 'number' && metrics.uptimePct < 98)           riskCounts['Infrastructure Uptime']   = (riskCounts['Infrastructure Uptime']   ?? 0) + 1
        if (typeof metrics.securityIncidents  === 'number' && metrics.securityIncidents > 1)    riskCounts['Security Incidents']      = (riskCounts['Security Incidents']      ?? 0) + 1
        if (typeof metrics.patchCompliancePct === 'number' && metrics.patchCompliancePct < 95)  riskCounts['Patch Compliance']        = (riskCounts['Patch Compliance']        ?? 0) + 1
        if (typeof metrics.avgResolutionHrs   === 'number' && metrics.avgResolutionHrs > 8)     riskCounts['Average Resolution Time'] = (riskCounts['Average Resolution Time'] ?? 0) + 1
      }
      topRiskFlags = Object.entries(riskCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([flag, count]) => ({ flag, count }))
    }

    // ── 7. High-risk clients — full analytics only ────────────────────────────
    let highRiskClients: any[] = []

    if (isFullAnalytics) {
      const latestPerClient: Record<string, typeof qbrs[0]> = {}
      for (const qbr of qbrs) {
        if (qbr.healthScore === null) continue
        if (!latestPerClient[qbr.clientId] ||
            qbr.createdAt > latestPerClient[qbr.clientId].createdAt) {
          latestPerClient[qbr.clientId] = qbr
        }
      }
      highRiskClients = Object.values(latestPerClient)
        .filter(q => (q.healthScore ?? 100) < 60)
        .map(q => ({
          clientName:   q.client.name,
          healthScore:  q.healthScore,
          healthStatus: q.healthStatus,
          lastQBR:      `Q${q.quarter} ${q.year}`,
        }))
        .sort((a, b) => (a.healthScore ?? 0) - (b.healthScore ?? 0))
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    const totalQBRs = await prisma.qBR.count({ where: { client: { workspaceId } } })

    return NextResponse.json({
      // Plan context — frontend uses this to know what to render
      analyticsAccess: limits.analytics,
      upgradeMessage:  isFullAnalytics ? null : UPGRADE_MESSAGES.analyticsLocked,

      summary: {
        totalClients,
        totalQBRs,
        totalPackages,
        totalDownloads,
        coveragePct,
        coveredClients,
        uncoveredClients,
        avgHealthScore,
        avgHealthStatus,
      },

      // Basic + full
      clients:     allClients,
      qbrActivity,

      // Full analytics only (empty arrays for basic plans)
      healthTrends,
      exportActivity,
      exportTotals:    { PDF: totalPDF, PPTX: totalPPTX, packages: totalPackages, downloads: totalDownloads },
      topRiskFlags,
      highRiskClients,
    })

  } catch (err: any) {
    console.error('[analytics]', err)
    return NextResponse.json({ error: err.message ?? 'Failed to load analytics' }, { status: 500 })
  }
}


