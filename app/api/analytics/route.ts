import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'

export async function GET() {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    const workspaceId = membership.workspaceId

    // ── 1. QBRs generated per month (last 6 months) ───────────────────────────
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

    const qbrs = await prisma.qBR.findMany({
      where: { client: { workspaceId }, createdAt: { gte: sixMonthsAgo } },
      select: {
  id: true,
  clientId: true,
  quarter: true,
  year: true,
  healthScore: true,
  healthStatus: true,
  rawMetrics: true,
  createdAt: true,
  client: { select: { name: true } },
},
      orderBy: { createdAt: 'asc' },
    })

    // Group by month
    const qbrsByMonth: Record<string, number> = {}
    for (const qbr of qbrs) {
      const key = qbr.createdAt.toISOString().slice(0, 7) // "2026-06"
      qbrsByMonth[key] = (qbrsByMonth[key] ?? 0) + 1
    }
    const qbrActivity = Object.entries(qbrsByMonth).map(([month, count]) => ({ month, count }))

    // ── 2. Health score trend per client ──────────────────────────────────────
    const allQbrs = await prisma.qBR.findMany({
      where: { client: { workspaceId }, healthScore: { not: null } },
      select: {
        id: true,
        clientId: true,
        quarter: true,
        year: true,
        healthScore: true,
        healthStatus: true,
        createdAt: true,
        rawMetrics   : true,
        client: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    // Group by client
    const trendMap: Record<string, { clientName: string; points: { label: string; score: number; status: string }[] }> = {}
    for (const qbr of allQbrs) {
      if (qbr.healthScore === null) continue
      if (!trendMap[qbr.clientId]) {
        trendMap[qbr.clientId] = { clientName: qbr.client.name, points: [] }
      }
      trendMap[qbr.clientId].points.push({
        label:  `Q${qbr.quarter} ${qbr.year}`,
        score:  qbr.healthScore,
        status: qbr.healthStatus ?? 'Unknown',
      })
    }
    const healthTrends = Object.values(trendMap)

    // ── 3. Export activity — PDF vs PPTX ──────────────────────────────────────
    const exportEvents = await prisma.exportEvent.findMany({
      where:   { workspaceId },
      select:  { exportType: true, exportedAt: true, consumedExportCredit: true },
      orderBy: { exportedAt: 'asc' },
    })

    const exportByMonth: Record<string, { PDF: number; PPTX: number }> = {}
    for (const ev of exportEvents) {
      const key = ev.exportedAt.toISOString().slice(0, 7)
      if (!exportByMonth[key]) exportByMonth[key] = { PDF: 0, PPTX: 0 }
      exportByMonth[key][ev.exportType]++
    }
    const exportActivity = Object.entries(exportByMonth).map(([month, counts]) => ({
      month, ...counts,
    }))

    const totalPDF  = exportEvents.filter(e => e.exportType === 'PDF').length
    const totalPPTX = exportEvents.filter(e => e.exportType === 'PPTX').length

    // ── 4. Client coverage — % with QBR in last 90 days ───────────────────────
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    const allClients = await prisma.client.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        qbrs: {
          where:   { createdAt: { gte: ninetyDaysAgo } },
          select:  { id: true },
          take:    1,
        },
      },
    })

    const totalClients   = allClients.length
    const coveredClients = allClients.filter(c => c.qbrs.length > 0).length
    const coveragePct    = totalClients > 0 ? Math.round((coveredClients / totalClients) * 100) : 0
    const uncoveredClients = allClients
      .filter(c => c.qbrs.length === 0)
      .map(c => c.name)

    // ── 5. Top risk flags ─────────────────────────────────────────────────────
    // Count how many QBRs flagged each metric as needing attention
    const riskCounts: Record<string, number> = {}
    for (const qbr of allQbrs) {
      const metrics = qbr.rawMetrics as Record<string, unknown> | null
      if (!metrics) continue
      if (typeof metrics.uptimePct === 'number'          && metrics.uptimePct < 98)   riskCounts['Low Uptime']            = (riskCounts['Low Uptime']            ?? 0) + 1
      if (typeof metrics.securityIncidents === 'number'  && metrics.securityIncidents > 1)  riskCounts['Security Incidents']    = (riskCounts['Security Incidents']    ?? 0) + 1
      if (typeof metrics.patchCompliancePct === 'number' && metrics.patchCompliancePct < 95) riskCounts['Patch Compliance Gap']  = (riskCounts['Patch Compliance Gap']  ?? 0) + 1
      if (typeof metrics.avgResolutionHrs === 'number'   && metrics.avgResolutionHrs > 8)   riskCounts['Slow Resolution Time']  = (riskCounts['Slow Resolution Time']  ?? 0) + 1
    }
    const topRiskFlags = Object.entries(riskCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([flag, count]) => ({ flag, count }))

    // ── 6. High-risk clients ──────────────────────────────────────────────────
    // Latest QBR per client where healthScore < 60
    const latestQbrPerClient: Record<string, typeof allQbrs[0]> = {}
    for (const qbr of allQbrs) {
      if (!latestQbrPerClient[qbr.clientId] ||
          qbr.createdAt > latestQbrPerClient[qbr.clientId].createdAt) {
        latestQbrPerClient[qbr.clientId] = qbr
      }
    }
    const highRiskClients = Object.values(latestQbrPerClient)
      .filter(q => (q.healthScore ?? 100) < 60)
      .map(q => ({
        clientName:   q.client.name,
        healthScore:  q.healthScore,
        healthStatus: q.healthStatus,
        lastQBR:      `Q${q.quarter} ${q.year}`,
      }))
      .sort((a, b) => (a.healthScore ?? 0) - (b.healthScore ?? 0))

    // ── Summary stats ─────────────────────────────────────────────────────────
    const totalQBRs     = await prisma.qBR.count({ where: { client: { workspaceId } } })
    const totalExports  = exportEvents.filter(e => e.consumedExportCredit).length

    return NextResponse.json({
      summary: {
        totalClients,
        totalQBRs,
        totalExports,
        coveragePct,
        coveredClients,
        uncoveredClients,
      },
      qbrActivity,
      healthTrends,
      exportActivity,
      exportTotals: { PDF: totalPDF, PPTX: totalPPTX },
      topRiskFlags,
      highRiskClients,
    })

  } catch (err: any) {
    console.error('[analytics]', err)
    return NextResponse.json({ error: err.message ?? 'Failed to load analytics' }, { status: 500 })
  }
}
