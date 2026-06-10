
'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  BarChart2, Users, FileText, TrendingUp,
  AlertTriangle, CheckCircle, Clock, Shield, Download,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Client { id: string; name: string }

interface AnalyticsData {
  summary: {
    totalClients:     number
    totalQBRs:        number
    totalPackages:    number
    totalDownloads:   number
    coveragePct:      number
    coveredClients:   number
    uncoveredClients: string[]
    avgHealthScore:   number | null
    avgHealthStatus:  string | null
  }
  clients:       Client[]
  qbrActivity:   { month: string; count: number }[]
  healthTrends:  {
    clientName: string
    points: { label: string; score: number; status: string; generatedDate: string; duplicateCount: number }[]
  }[]
  exportActivity: { month: string; PDF: number; PPTX: number }[]
  exportTotals:   { PDF: number; PPTX: number; packages: number; downloads: number }
  topRiskFlags:   { flag: string; count: number }[]
  highRiskClients: { clientName: string; healthScore: number | null; healthStatus: string | null; lastQBR: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMonth(m: string) {
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function statusColor(status: string | null) {
  if (!status) return 'text-gray-400'
  if (status === 'Excellent' || status === 'Strong') return 'text-green-600'
  if (status === 'Stable with Improvement Needed' || status === 'Needs Attention') return 'text-amber-600'
  return 'text-red-600'
}

function statusBg(status: string | null) {
  if (!status) return 'bg-gray-50 border-gray-200'
  if (status === 'Excellent' || status === 'Strong') return 'bg-green-50 border-green-200'
  if (status === 'Stable with Improvement Needed' || status === 'Needs Attention') return 'bg-amber-50 border-amber-200'
  return 'bg-red-50 border-red-200'
}

function scoreBarColor(score: number) {
  return score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500'
}

// ── Bar chart component ───────────────────────────────────────────────────────

function SimpleBarChart({ data, valueKey, color = 'bg-navy-600', label = '' }: {
  data:      Record<string, string | number>[]
  valueKey:  string
  color?:    string
  label?:    string
}) {
  const values = data.map(d => Number(d[valueKey]) || 0)
  const max    = Math.max(...values, 1)

  if (data.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-6">No data in this period.</p>
  }

  return (
    <div className={`flex items-end gap-2 h-20 pt-2 ${data.length === 1 ? 'px-24' : ''}`}>
      {data.map((d, i) => {
        const val = Number(d[valueKey]) || 0
        const hPct = Math.max((val / max) * 70, val > 0 ? 8 : 0)
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
            {/* Tooltip */}
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:flex bg-navy-800 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap z-10 shadow-lg">
              {formatMonth(String(d.month))}: <strong className="ml-1">{val}</strong>{label ? ` ${label}` : ''}
            </div>
            {/* Value label on bar */}
            {val > 0 && (
              <span className="text-[10px] font-semibold text-navy-700 mb-0.5">{val}</span>
            )}
            <div className="w-full flex flex-col justify-end" style={{ height: '64px' }}>
              <div
                className={`w-full rounded-t ${color} hover:opacity-80 transition-opacity`}
                style={{ height: `${hPct}%`, minHeight: val > 0 ? '6px' : '0' }}
              />
            </div>
            <span className="text-[9px] text-gray-400 text-center leading-tight">{formatMonth(String(d.month))}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Export donut ──────────────────────────────────────────────────────────────

function ExportDonut({ pdf, pptx }: { pdf: number; pptx: number }) {
  const total = pdf + pptx
  if (total === 0) return <p className="text-sm text-gray-400 text-center py-6">No exports yet.</p>

  const pdfPct  = Math.round((pdf  / total) * 100)
  const pptxPct = 100 - pdfPct
  const r = 36, cx = 44, cy = 44, circumference = 2 * Math.PI * r
  const pdfDash  = (pdfPct  / 100) * circumference
  const pptxDash = (pptxPct / 100) * circumference

  return (
    <div className="flex items-center gap-6">
      <svg width="88" height="88" viewBox="0 0 88 88">
        {/* PPTX (gold, background arc) */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#B8973A" strokeWidth="10"
          strokeDasharray={`${pptxDash} ${circumference - pptxDash}`}
          strokeDashoffset={-pdfDash} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
        {/* PDF (navy, foreground arc) */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e3a5f" strokeWidth="10"
          strokeDasharray={`${pdfDash} ${circumference - pdfDash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="13" fontWeight="700" fill="#1e3a5f">{total}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="8" fill="#9ca3af">downloads</text>
      </svg>
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-navy-800" />
          <span className="text-gray-600">PDF</span>
          <span className="font-semibold text-navy-800 ml-auto pl-4">{pdf}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-gold-500" />
          <span className="text-gray-600">PowerPoint</span>
          <span className="font-semibold text-navy-800 ml-auto pl-4">{pptx}</span>
        </div>
        <div className="border-t border-gray-100 pt-2 flex items-center gap-2">
          <span className="text-gray-500 text-xs">Packages used</span>
          <span className="font-semibold text-navy-800 ml-auto pl-4 text-xs">{Math.ceil(total / 2)}</span>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { value: '30d', label: 'Last 30 days'  },
  { value: '90d', label: 'Last 90 days'  },
  { value: '6m',  label: 'Last 6 months' },
  { value: '1y',  label: 'This year'     },
  { value: 'all', label: 'All time'      },
]

export default function AnalyticsPage() {
  const [data,     setData]     = useState<AnalyticsData | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [range,    setRange]    = useState('6m')
  const [clientId, setClientId] = useState('all')

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/analytics?range=${range}&clientId=${clientId}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setError('Failed to load analytics.'); setLoading(false) })
  }, [range, clientId])

  useEffect(() => { load() }, [load])

  // ── Empty state ─────────────────────────────────────────────────────────────
  const isEmpty = data && data.summary.totalQBRs === 0 && data.qbrActivity.length === 0

  if (loading) {
    return (
      <div className="p-8">
        <div className="h-8 bg-gray-100 rounded w-32 mb-2 animate-pulse" />
        <div className="h-4 bg-gray-100 rounded w-48 mb-8 animate-pulse" />
        <div className="grid grid-cols-5 gap-4 mb-8">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="h-3 bg-gray-100 rounded w-20 mb-3" />
              <div className="h-7 bg-gray-100 rounded w-12" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-navy-800 mb-2">Analytics</h1>
        <p className="text-red-500 text-sm">{error}</p>
      </div>
    )
  }

  if (!data) return null

  const { summary, clients, qbrActivity, healthTrends, exportActivity, exportTotals, topRiskFlags, highRiskClients } = data

  return (
    <div className="p-8">

      {/* ── Header + filters ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-navy-800">Analytics</h1>
          <p className="text-gray-500 text-sm mt-1">Workspace performance · all data is scoped to your workspace</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Client filter */}
          <select
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            className="input text-sm py-1.5 px-3 pr-8"
          >
            <option value="all">All clients</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {/* Date range filter */}
          <select
            value={range}
            onChange={e => setRange(e.target.value)}
            className="input text-sm py-1.5 px-3 pr-8"
          >
            {RANGE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Empty state ────────────────────────────────────────────────────────── */}
      {isEmpty ? (
        <div className="card p-16 text-center">
          <BarChart2 size={40} className="mx-auto text-gray-200 mb-4" />
          <p className="text-gray-500 font-medium mb-1">No analytics yet</p>
          <p className="text-gray-400 text-sm">Generate your first QBR to see trends, coverage, exports, and risk insights.</p>
        </div>
      ) : (
        <>
          {/* ── Summary KPI cards ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-5 gap-4 mb-8">
            {[
              {
                label: 'Total clients',
                value: summary.totalClients,
                icon:  Users,
                color: 'bg-blue-50 text-blue-600',
              },
              {
                label: 'QBRs generated',
                value: summary.totalQBRs,
                icon:  FileText,
                color: 'bg-purple-50 text-purple-600',
              },
              {
                label: 'Export packages',
                value: summary.totalPackages,
                sub:   `${summary.totalDownloads} file downloads`,
                icon:  Download,
                color: 'bg-green-50 text-green-600',
              },
              {
                label: 'Client coverage',
                value: `${summary.coveragePct}%`,
                sub:   'QBR in last 90 days',
                icon:  CheckCircle,
                color: summary.coveragePct >= 80 ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600',
              },
              {
                label: 'Avg health score',
                value: summary.avgHealthScore !== null ? `${summary.avgHealthScore}/100` : '—',
                sub:   summary.avgHealthStatus ?? '',
                icon:  TrendingUp,
                color: summary.avgHealthScore === null ? 'bg-gray-50 text-gray-400'
                  : summary.avgHealthScore >= 80 ? 'bg-green-50 text-green-600'
                  : summary.avgHealthScore >= 60 ? 'bg-amber-50 text-amber-600'
                  : 'bg-red-50 text-red-600',
              },
            ].map(s => (
              <div key={s.label} className="card p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-gray-500 font-medium">{s.label}</span>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.color}`}>
                    <s.icon size={15} />
                  </div>
                </div>
                <div className="text-xl font-bold text-navy-800 leading-none">{s.value}</div>
                {s.sub && <div className="text-[11px] text-gray-400 mt-1">{s.sub}</div>}
              </div>
            ))}
          </div>

          {/* ── Row 1: QBR activity + Export activity ─────────────────────────── */}
          <div className="grid grid-cols-2 gap-5 mb-5">

            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <BarChart2 size={14} className="text-gray-400" />
                <h2 className="font-semibold text-navy-800 text-sm">QBRs generated</h2>
                <span className="ml-auto text-xs text-gray-400">
                  {RANGE_OPTIONS.find(o => o.value === range)?.label}
                </span>
              </div>
              <SimpleBarChart data={qbrActivity as any} valueKey="count" color="bg-navy-600" label="QBRs" />
            </div>

            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <FileText size={14} className="text-gray-400" />
                <h2 className="font-semibold text-navy-800 text-sm">Export activity</h2>
                <span className="ml-auto text-xs text-gray-400">PDF vs PowerPoint</span>
              </div>
              <ExportDonut pdf={exportTotals.PDF} pptx={exportTotals.PPTX} />
              <p className="text-[11px] text-gray-400 mt-3 border-t border-gray-50 pt-3">
                One export package includes both PDF and PowerPoint for the same QBR.
              </p>
            </div>
          </div>

          {/* ── Row 2: Health score trends ────────────────────────────────────── */}
          <div className="card p-5 mb-5">
            <div className="flex items-center gap-2 mb-5">
              <TrendingUp size={14} className="text-gray-400" />
              <h2 className="font-semibold text-navy-800 text-sm">Health score trends</h2>
              <span className="ml-auto text-xs text-gray-400">latest QBR per client per quarter</span>
            </div>
            {healthTrends.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">No scored QBRs in this period.</p>
            ) : (
              <div className="space-y-6">
                {healthTrends.map(client => (
                  <div key={client.clientName}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-navy-800">{client.clientName}</span>
                      <span className={`text-xs font-medium ${statusColor(client.points.at(-1)?.status ?? null)}`}>
                        {client.points.at(-1)?.status ?? '—'}
                      </span>
                    </div>
                    <div className="flex items-start gap-3 overflow-x-auto pb-1">
                      {client.points.map((pt, i) => (
                        <div key={i} className="flex-shrink-0 w-24 text-center">
                          <div className={`rounded-lg border p-3 mb-1 ${statusBg(pt.status)}`}>
                            <div className="text-xl font-bold text-navy-800">{pt.score}</div>
                            <div className="text-[9px] text-gray-400">/100</div>
                          </div>
                          <div className="text-[10px] text-gray-500 font-medium">{pt.label}</div>
                          <div className="text-[9px] text-gray-400">Generated {pt.generatedDate}</div>
                          {pt.duplicateCount > 1 && (
                            <div className="text-[9px] text-amber-600 mt-0.5">{pt.duplicateCount} QBRs</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Row 3: Risk flags + High-risk clients ─────────────────────────── */}
          <div className="grid grid-cols-2 gap-5 mb-5">

            <div className="card p-5">
              <div className="flex items-center gap-2 mb-5">
                <AlertTriangle size={14} className="text-gray-400" />
                <h2 className="font-semibold text-navy-800 text-sm">Top risk flags</h2>
                <span className="ml-auto text-xs text-gray-400">from QBR metrics</span>
              </div>
              {topRiskFlags.length === 0 ? (
                <div className="flex flex-col items-center py-4 gap-2">
                  <CheckCircle size={24} className="text-green-400" />
                  <p className="text-sm text-gray-400">No risk flags in this period.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {topRiskFlags.map(({ flag, count }) => {
                    const maxCount = topRiskFlags[0].count
                    const pct      = Math.round((count / maxCount) * 100)
                    return (
                      <div key={flag}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm text-gray-700">{flag}</span>
                          <span className="text-xs font-semibold text-navy-800">{count} QBR{count !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-red-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="card p-5">
              <div className="flex items-center gap-2 mb-5">
                <Shield size={14} className="text-gray-400" />
                <h2 className="font-semibold text-navy-800 text-sm">High-risk clients</h2>
                <span className="ml-auto text-xs text-gray-400">High Risk = score below 60</span>
              </div>
              {highRiskClients.length === 0 ? (
                <div className="flex flex-col items-center py-4 gap-2">
                  <CheckCircle size={24} className="text-green-400" />
                  <p className="text-sm text-gray-400">No high-risk clients.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {highRiskClients.map(c => (
                    <div key={c.clientName}>
                      <div className="flex items-center justify-between mb-1">
                        <div>
                          <span className="text-sm font-medium text-navy-800">{c.clientName}</span>
                          <span className="text-xs text-gray-400 ml-2">{c.lastQBR}</span>
                        </div>
                        <span className="text-xs font-medium text-red-600">{c.healthStatus}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${scoreBarColor(c.healthScore ?? 0)}`}
                            style={{ width: `${c.healthScore ?? 0}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-navy-800 w-8 text-right">{c.healthScore}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Row 4: Uncovered clients ──────────────────────────────────────── */}
          {summary.uncoveredClients.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Clock size={14} className="text-gray-400" />
                <h2 className="font-semibold text-navy-800 text-sm">Clients without a recent QBR</h2>
                <span className="ml-auto text-xs text-gray-400">no QBR in last 90 days</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {summary.uncoveredClients.map(name => (
                  <span key={name} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800 font-medium">
                    <Clock size={10} />
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
