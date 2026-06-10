'use client'

import { useEffect, useState } from 'react'
import { BarChart2, Users, FileText, TrendingUp, AlertTriangle, CheckCircle, Clock, Shield } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnalyticsData {
  summary: {
    totalClients:      number
    totalQBRs:         number
    totalExports:      number
    coveragePct:       number
    coveredClients:    number
    uncoveredClients:  string[]
  }
  qbrActivity:    { month: string; count: number }[]
  healthTrends:   { clientName: string; points: { label: string; score: number; status: string }[] }[]
  exportActivity: { month: string; PDF: number; PPTX: number }[]
  exportTotals:   { PDF: number; PPTX: number }
  topRiskFlags:   { flag: string; count: number }[]
  highRiskClients: { clientName: string; healthScore: number | null; healthStatus: string | null; lastQBR: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMonth(m: string) {
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function statusColor(status: string | null) {
  if (!status) return 'text-gray-400'
  if (status === 'Excellent' || status === 'Strong') return 'text-green-600'
  if (status === 'Stable with Improvement Needed' || status === 'Needs Attention') return 'text-amber-600'
  return 'text-red-600'
}

function statusBg(status: string | null) {
  if (!status) return 'bg-gray-100'
  if (status === 'Excellent' || status === 'Strong') return 'bg-green-50 border-green-200'
  if (status === 'Stable with Improvement Needed' || status === 'Needs Attention') return 'bg-amber-50 border-amber-200'
  return 'bg-red-50 border-red-200'
}

function scoreBar(score: number) {
  const pct   = Math.max(0, Math.min(100, score))
  const color = score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-navy-800 w-8 text-right">{score}</span>
    </div>
  )
}

// ── Mini bar chart ────────────────────────────────────────────────────────────

function BarChart({ data, valueKey, label }: {
  data:     { month: string; [k: string]: number | string }[]
  valueKey: string
  label:    string
}) {
  const values = data.map(d => Number(d[valueKey]) || 0)
  const max    = Math.max(...values, 1)
  return (
    <div className="flex items-end gap-1.5 h-24">
      {data.map((d, i) => {
        const val = Number(d[valueKey]) || 0
        const h   = Math.round((val / max) * 100)
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:flex bg-navy-800 text-white text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-10">
              {formatMonth(String(d.month))}: {val} {label}
            </div>
            <div
              className="w-full rounded-t bg-navy-600 group-hover:bg-gold-500 transition-colors"
              style={{ height: `${Math.max(h, 4)}%` }}
            />
            <span className="text-[9px] text-gray-400">{formatMonth(String(d.month))}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Stacked bar chart for exports ─────────────────────────────────────────────

function ExportBarChart({ data }: { data: { month: string; PDF: number; PPTX: number }[] }) {
  const maxVal = Math.max(...data.map(d => d.PDF + d.PPTX), 1)
  return (
    <div className="flex items-end gap-1.5 h-24">
      {data.map((d, i) => {
        const total  = d.PDF + d.PPTX
        const pdfH   = Math.round((d.PDF  / maxVal) * 100)
        const pptxH  = Math.round((d.PPTX / maxVal) * 100)
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
            <div className="absolute -top-10 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col bg-navy-800 text-white text-[10px] rounded px-1.5 py-1 whitespace-nowrap z-10 gap-0.5">
              <span>{formatMonth(d.month)}</span>
              <span>PDF: {d.PDF} · PPTX: {d.PPTX}</span>
            </div>
            <div className="w-full flex flex-col" style={{ height: `${Math.max(pdfH + pptxH, 4)}%` }}>
              <div className="w-full bg-gold-500 rounded-t" style={{ height: `${total > 0 ? (d.PPTX / total) * 100 : 0}%` }} />
              <div className="w-full bg-navy-600 flex-1 rounded-b" />
            </div>
            <span className="text-[9px] text-gray-400">{formatMonth(d.month)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [data,    setData]    = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    fetch('/api/analytics')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setError('Failed to load analytics.'); setLoading(false) })
  }, [])

  if (loading) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-navy-800">Analytics</h1>
          <p className="text-gray-500 text-sm mt-1">Loading workspace data…</p>
        </div>
        <div className="grid grid-cols-4 gap-5 mb-8">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="h-3 bg-gray-100 rounded w-24 mb-3" />
              <div className="h-7 bg-gray-100 rounded w-12" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-navy-800 mb-2">Analytics</h1>
        <p className="text-red-500 text-sm">{error || 'No data available.'}</p>
      </div>
    )
  }

  const { summary, qbrActivity, healthTrends, exportActivity, exportTotals, topRiskFlags, highRiskClients } = data

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy-800">Analytics</h1>
        <p className="text-gray-500 text-sm mt-1">
          Workspace performance · last 6 months
        </p>
      </div>

      {/* ── Summary stats ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-5 mb-8">
        {[
          { label: 'Total clients',   value: summary.totalClients,  icon: Users,      color: 'bg-blue-50 text-blue-600'    },
          { label: 'QBRs generated',  value: summary.totalQBRs,     icon: FileText,   color: 'bg-purple-50 text-purple-600' },
          { label: 'Exports sent',    value: summary.totalExports,  icon: TrendingUp, color: 'bg-green-50 text-green-600'  },
          { label: 'Client coverage', value: `${summary.coveragePct}%`, icon: CheckCircle, color: summary.coveragePct >= 80 ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600' },
        ].map(s => (
          <div key={s.label} className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-gray-500 font-medium">{s.label}</span>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.color}`}>
                <s.icon size={16} />
              </div>
            </div>
            <div className="text-2xl font-bold text-navy-800">{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Row 1: QBR Activity + Export Activity ────────────────────────────── */}
      <div className="grid grid-cols-2 gap-5 mb-5">

        {/* QBR Activity */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-5">
            <BarChart2 size={15} className="text-gray-400" />
            <h2 className="font-semibold text-navy-800 text-sm">QBRs generated</h2>
            <span className="ml-auto text-xs text-gray-400">last 6 months</span>
          </div>
          {qbrActivity.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No QBRs generated yet.</p>
          ) : (
            <BarChart data={qbrActivity} valueKey="count" label="QBRs" />
          )}
        </div>

        {/* Export Activity */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <FileText size={15} className="text-gray-400" />
            <h2 className="font-semibold text-navy-800 text-sm">Export activity</h2>
            <span className="ml-auto text-xs text-gray-400">PDF vs PPTX</span>
          </div>
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-navy-600" />
              <span className="text-xs text-gray-500">PDF ({exportTotals.PDF})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-gold-500" />
              <span className="text-xs text-gray-500">PPTX ({exportTotals.PPTX})</span>
            </div>
          </div>
          {exportActivity.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No exports yet.</p>
          ) : (
            <ExportBarChart data={exportActivity} />
          )}
        </div>
      </div>

      {/* ── Row 2: Health Score Trends ────────────────────────────────────────── */}
      <div className="card p-5 mb-5">
        <div className="flex items-center gap-2 mb-5">
          <TrendingUp size={15} className="text-gray-400" />
          <h2 className="font-semibold text-navy-800 text-sm">Health score trends</h2>
          <span className="ml-auto text-xs text-gray-400">per client, all QBRs</span>
        </div>
        {healthTrends.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">Generate QBRs to see health score trends.</p>
        ) : (
          <div className="space-y-5">
            {healthTrends.map(client => (
              <div key={client.clientName}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-navy-800">{client.clientName}</span>
                  <span className={`text-xs font-medium ${statusColor(client.points.at(-1)?.status ?? null)}`}>
                    {client.points.at(-1)?.status ?? '—'}
                  </span>
                </div>
                <div className="flex items-end gap-3 overflow-x-auto pb-1">
                  {client.points.map((pt, i) => (
                    <div key={i} className="flex-shrink-0 w-20">
                      <div className={`rounded-lg border p-2.5 mb-1 text-center ${statusBg(pt.status)}`}>
                        <div className="text-lg font-bold text-navy-800">{pt.score}</div>
                        <div className="text-[9px] text-gray-500 mt-0.5">/100</div>
                      </div>
                      <div className="text-[10px] text-gray-400 text-center">{pt.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Row 3: Top Risk Flags + High-Risk Clients ─────────────────────────── */}
      <div className="grid grid-cols-2 gap-5 mb-5">

        {/* Top risk flags */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-5">
            <AlertTriangle size={15} className="text-gray-400" />
            <h2 className="font-semibold text-navy-800 text-sm">Top risk flags</h2>
            <span className="ml-auto text-xs text-gray-400">across all clients</span>
          </div>
          {topRiskFlags.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No risk flags detected.</p>
          ) : (
            <div className="space-y-3">
              {topRiskFlags.map(({ flag, count }) => {
                const maxCount = topRiskFlags[0].count
                const pct      = Math.round((count / maxCount) * 100)
                return (
                  <div key={flag}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-700">{flag}</span>
                      <span className="text-xs font-semibold text-navy-800">{count} QBR{count !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-red-400 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* High-risk clients */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-5">
            <Shield size={15} className="text-gray-400" />
            <h2 className="font-semibold text-navy-800 text-sm">High-risk clients</h2>
            <span className="ml-auto text-xs text-gray-400">score below 60</span>
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
                  {scoreBar(c.healthScore ?? 0)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 4: Client coverage detail ────────────────────────────────────── */}
      {summary.uncoveredClients.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={15} className="text-gray-400" />
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
    </div>
  )
}
