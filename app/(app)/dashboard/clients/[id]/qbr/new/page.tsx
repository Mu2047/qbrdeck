'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Zap, Download, FileText, CheckCircle, AlertTriangle, XCircle, Upload, X } from 'lucide-react'
import Link from 'next/link'
import { SlideBody } from '@/components/qbr/SlideBody'

interface Metric { label: string; value: string; status: 'good' | 'caution' | 'risk' }
interface Slide { title: string; type: string; content: string; bullets?: string[]; metrics?: Metric[] }

const COLUMN_MAP: Record<string, string> = {
  'total tickets': 'tickets', 'tickets': 'tickets', 'ticket count': 'tickets',
  'tickets resolved': 'tickets', 'resolved tickets': 'tickets',
  'tickets closed': 'tickets', 'closed tickets': 'tickets',
  'avg resolution time': 'avgResolutionHrs', 'average resolution time': 'avgResolutionHrs',
  'avg resolution hours': 'avgResolutionHrs', 'average resolution hours': 'avgResolutionHrs',
  'resolution time': 'avgResolutionHrs', 'avg resolution (hrs)': 'avgResolutionHrs',
  'uptime': 'uptimePct', 'uptime %': 'uptimePct', 'infrastructure uptime': 'uptimePct',
  'uptime percent': 'uptimePct', 'availability %': 'uptimePct',
  'patch compliance': 'patchCompliancePct', 'patch compliance %': 'patchCompliancePct',
  'patch compliance percent': 'patchCompliancePct', 'patching compliance': 'patchCompliancePct',
  'security incidents': 'securityIncidents', 'incidents': 'securityIncidents',
  'security events': 'securityIncidents', 'security alerts': 'securityIncidents',
  'users supported': 'usersSupported', 'users': 'usersSupported',
  'user count': 'usersSupported', 'total users': 'usersSupported',
  'users managed': 'usersSupported',
}

function parseCSV(text: string): Record<string, string> {
  const lines = text.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row.')
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase().replace(/_/g, ' '))
  const values  = lines[1].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
  const result: Record<string, string> = {}
  let matched = 0
  headers.forEach((header, i) => {
    const field = COLUMN_MAP[header]
    if (field && values[i]) { result[field] = values[i]; matched++ }
  })
  result['_matched'] = String(matched)
  return result
}

const SAMPLE_CSV = `total_tickets,avg_resolution_hours,uptime_%,patch_compliance_%,security_incidents,users_supported
125,4.6,99.8,94,3,82`

function downloadSample() {
  const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = 'qbrdeck-sample-metrics.csv'; a.click()
  URL.revokeObjectURL(url)
}

export default function NewQBRPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Read URL search params for pre-filling from "Start QBR" reminder action
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const defaultQuarter = searchParams?.get('quarter') ?? '3'
  const defaultYear    = searchParams?.get('year')    ?? String(new Date().getFullYear())

  const [step, setStep]           = useState<'form' | 'preview'>('form')
  const [loading, setLoading]     = useState(false)
  const [exporting, setExporting] = useState<'pdf' | 'pptx' | null>(null)
  const [error, setError]         = useState('')
  const [slides, setSlides]       = useState<Slide[]>([])
  const [qbrId, setQbrId]         = useState('')
  // Deterministic values returned by /api/generate-qbr — used for the cover
  // and passed into SlideBody for the health-score metric card. Never derived
  // from any individual slide's AI-authored metric status.
  const [clientName, setClientName]     = useState('')
  const [healthScore, setHealthScore]   = useState<number | null>(null)
  const [healthStatus, setHealthStatus] = useState<string | null>(null)

  // ── Subscription / limit state ───────────────────────────────────────────
  const [qbrLimitReached, setQbrLimitReached] = useState(false)

  useEffect(() => {
    fetch('/api/subscription')
      .then(r => r.json())
      .then((data: any) => {
        const sub = data?.subscription
        if (sub?.plan === 'FREE' && (sub?.qbrCount ?? 0) >= 3) {
          setQbrLimitReached(true)
        }
      })
      .catch(() => {})
  }, [])

  // CSV state
  const [csvStatus, setCsvStatus] = useState<{ matched: number; total: number; fileName: string } | null>(null)
  const [csvError, setCsvError]   = useState('')

  const [form, setForm] = useState({
    quarter: defaultQuarter, year: Number(defaultYear),
    tickets: '', avgResolutionHrs: '', uptimePct: '', patchCompliancePct: '',
    securityIncidents: '', usersSupported: '', ticketCategories: '', wins: '', upsellOpportunities: '',
  })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  function clearCSV() {
    setCsvStatus(null); setCsvError('')
    setForm(f => ({ ...f, tickets: '', avgResolutionHrs: '', uptimePct: '', patchCompliancePct: '', securityIncidents: '', usersSupported: '' }))
  }

  async function handleCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvError(''); setCsvStatus(null)
    if (!file.name.endsWith('.csv')) { setCsvError('Please upload a .csv file.'); return }
    try {
      const text   = await file.text()
      const parsed = parseCSV(text)
      const matched = Number(parsed['_matched'])
      setForm(f => ({
        ...f,
        tickets:            parsed.tickets            ?? f.tickets,
        avgResolutionHrs:   parsed.avgResolutionHrs   ?? f.avgResolutionHrs,
        uptimePct:          parsed.uptimePct           ?? f.uptimePct,
        patchCompliancePct: parsed.patchCompliancePct  ?? f.patchCompliancePct,
        securityIncidents:  parsed.securityIncidents   ?? f.securityIncidents,
        usersSupported:     parsed.usersSupported      ?? f.usersSupported,
      }))
      setCsvStatus({ matched, total: 6, fileName: file.name })
    } catch (err: any) {
      setCsvError(err.message ?? 'Unable to read this CSV.')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function generate() {
    if (qbrLimitReached) { router.push('/dashboard/billing'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/generate-qbr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: params.id,
          quarter: form.quarter, year: Number(form.year),
          tickets:            form.tickets            ? Number(form.tickets)            : undefined,
          avgResolutionHrs:   form.avgResolutionHrs   ? Number(form.avgResolutionHrs)   : undefined,
          uptimePct:          form.uptimePct           ? Number(form.uptimePct)           : undefined,
          patchCompliancePct: form.patchCompliancePct  ? Number(form.patchCompliancePct)  : undefined,
          securityIncidents:  form.securityIncidents   ? Number(form.securityIncidents)   : undefined,
          usersSupported:     form.usersSupported      ? Number(form.usersSupported)      : undefined,
          ticketCategories:   form.ticketCategories    || undefined,
          wins:               form.wins                || undefined,
          upsellOpportunities: form.upsellOpportunities || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === 'LIMIT_REACHED') {
          setQbrLimitReached(true)
          setError('You\'ve reached your Free plan limit for this month. Upgrade to continue generating and exporting new QBRs.')
          setLoading(false)
          return
        }
        throw new Error(
          typeof data.error === 'string'
            ? data.error
            : data.message ?? data.error?.message ?? 'Generation failed. Please try again.'
        )
      }
      setSlides(data.slides)
      setQbrId(data.qbrId)
      setClientName(data.clientName ?? '')
      setHealthScore(data.healthScore ?? null)
      setHealthStatus(data.healthStatus ?? null)
      setStep('preview')
    } catch (e: any) {
      setError(e.message || 'Generation failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function exportFile(type: 'pdf' | 'pptx') {
    setExporting(type)
    try {
      const res = await fetch(`/api/export-${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qbrId }),
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = res.headers.get('content-disposition')?.split('filename=')[1]?.replace(/"/g, '') ?? `qbr.${type}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setExporting(null)
    }
  }

  // ── Preview step ────────────────────────────────────────────────────────────
  if (step === 'preview') {
    return (
      <div className="p-8 max-w-4xl">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setStep('form')} className="btn-secondary text-sm py-1.5 px-3">
            <ArrowLeft size={14} /> Back
          </button>
          <h1 className="text-xl font-bold text-navy-800">QBR Preview</h1>
        </div>
        <div className="card p-4 mb-6 flex items-center justify-between">
          <p className="text-sm text-gray-600">Your QBR is ready. Export it to send to your client.</p>
          <div className="flex gap-3">
            <button onClick={() => exportFile('pdf')} disabled={!!exporting} className="btn-secondary text-sm py-2">
              {exporting === 'pdf' ? 'Exporting...' : <><Download size={14} /> PDF</>}
            </button>
            <button onClick={() => exportFile('pptx')} disabled={!!exporting} className="btn-primary text-sm py-2">
              {exporting === 'pptx' ? 'Exporting...' : <><FileText size={14} /> PowerPoint</>}
            </button>
          </div>
        </div>

        {/* ── Cover ── */}
        {/* clientName/healthScore/healthStatus come from the generation
            route's deterministic response fields — never from an individual
            slide's AI-authored metric status. */}
        <div className="card mb-4 overflow-hidden">
          <div className="bg-navy-800 p-8 flex items-center justify-between">
            <div>
              <p className="text-gold-300 text-xs tracking-widest mb-3">QUARTERLY BUSINESS REVIEW</p>
              <p className="text-white text-2xl font-bold mb-1">{clientName}</p>
              <p className="text-gold-300 text-lg">Q{form.quarter} {form.year}</p>
            </div>
            <div className="bg-[#0d1f3c] rounded-lg border border-gold-500 px-5 py-3 text-center flex-shrink-0">
              <p className="text-gold-300 text-[10px] tracking-widest mb-1">TECH HEALTH SCORE</p>
              <p className="text-white text-3xl font-bold">
                {healthScore != null ? healthScore : 'N/A'}
                <span className="text-sm text-gray-400">/100</span>
              </p>
              <p className="text-white text-sm font-semibold mt-1">{healthStatus ?? 'Not assessed'}</p>
            </div>
          </div>
        </div>

        {slides.map((slide, i) => (
          <SlideBody key={i} slide={slide} index={i} healthStatus={healthStatus} />
        ))}
        {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
      </div>
    )
  }

  // ── Form step ───────────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <Link href={`/dashboard/clients/${params.id}`} className="btn-secondary text-sm py-1.5 px-3">
          <ArrowLeft size={14} /> Back
        </Link>
        <h1 className="text-xl font-bold text-navy-800">Generate new QBR</h1>
      </div>

      <div className="card p-6 space-y-5">

        {/* Quarter & Year */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Quarter</label>
            <select className="input" value={form.quarter} onChange={e => set('quarter', e.target.value)}>
              <option value="1">Q1 (Jan–Mar)</option>
              <option value="2">Q2 (Apr–Jun)</option>
              <option value="3">Q3 (Jul–Sep)</option>
              <option value="4">Q4 (Oct–Dec)</option>
            </select>
          </div>
          <div>
            <label className="label">Year</label>
            <input className="input" type="number" value={form.year} onChange={e => set('year', e.target.value)} />
          </div>
        </div>

        <hr className="border-gray-100" />

        {/* CSV Import */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Import metrics from CSV</p>
            <button onClick={downloadSample} className="text-xs text-navy-700 underline hover:text-navy-900">
              Download sample CSV
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleCSV} />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full border-2 border-dashed border-gray-200 rounded-lg p-4 flex items-center justify-center gap-2 text-sm text-gray-500 hover:border-navy-400 hover:text-navy-700 transition-colors"
          >
            <Upload size={16} /> Click to upload CSV from your PSA
          </button>
          <p className="text-xs text-gray-400 mt-1.5">
            Supported: CSV exports from ConnectWise, Autotask, Halo, NinjaOne, or the QBR Deck sample template.
          </p>
          {csvStatus && (
            <div className="mt-3">
              <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg p-3">
                <CheckCircle size={15} className="text-green-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-green-800 font-medium">
                    CSV imported successfully — {csvStatus.matched} of {csvStatus.total} key metrics detected.
                  </p>
                  <p className="text-xs text-green-600 mt-0.5">Review the fields below before generating your QBR.</p>
                  <button onClick={clearCSV} className="mt-2 text-xs font-medium text-green-700 underline hover:text-red-600 transition-colors">
                    Clear imported metrics
                  </button>
                </div>
                <button onClick={clearCSV} className="text-green-400 hover:text-green-600"><X size={14} /></button>
              </div>
            </div>
          )}
          {csvError && (
            <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
              <XCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{csvError}</p>
            </div>
          )}
        </div>

        <hr className="border-gray-100" />
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Key metrics</p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Tickets closed</label>
            <input className="input" type="number" placeholder="142" value={form.tickets} onChange={e => set('tickets', e.target.value)} />
          </div>
          <div>
            <label className="label">Avg resolution time (hrs)</label>
            <input className="input" type="number" step="0.1" placeholder="3.2" value={form.avgResolutionHrs} onChange={e => set('avgResolutionHrs', e.target.value)} />
          </div>
          <div>
            <label className="label">Uptime %</label>
            <input className="input" type="number" step="0.01" placeholder="99.7" value={form.uptimePct} onChange={e => set('uptimePct', e.target.value)} />
          </div>
          <div>
            <label className="label">Patch compliance %</label>
            <input className="input" type="number" placeholder="94" value={form.patchCompliancePct} onChange={e => set('patchCompliancePct', e.target.value)} />
          </div>
          <div>
            <label className="label">Security incidents</label>
            <input className="input" type="number" placeholder="0" value={form.securityIncidents} onChange={e => set('securityIncidents', e.target.value)} />
          </div>
          <div>
            <label className="label">Users supported</label>
            <input className="input" type="number" placeholder="48" value={form.usersSupported} onChange={e => set('usersSupported', e.target.value)} />
          </div>
        </div>

        <hr className="border-gray-100" />
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Context for AI</p>

        <div>
          <label className="label">Top ticket categories <span className="text-gray-400 font-normal">(comma separated)</span></label>
          <input className="input" placeholder="Password resets, VPN issues, Printer setup" value={form.ticketCategories} onChange={e => set('ticketCategories', e.target.value)} />
        </div>
        <div>
          <label className="label">Notable wins & completed projects this quarter</label>
          <textarea className="input" rows={3} placeholder="e.g. Completed M365 migration, deployed MFA..." value={form.wins} onChange={e => set('wins', e.target.value)} />
        </div>
        <div>
          <label className="label">Risks or upsell opportunities <span className="text-gray-400 font-normal">(optional)</span></label>
          <textarea className="input" rows={2} placeholder="e.g. No EDR solution in place..." value={form.upsellOpportunities} onChange={e => set('upsellOpportunities', e.target.value)} />
        </div>

        {/* Limit warning */}
        {qbrLimitReached && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
            <p className="text-sm text-amber-800">
              You've reached your Free plan limit for this month. Upgrade to continue generating and exporting new QBRs.
            </p>
            <a href="/dashboard/billing" className="text-sm font-medium text-amber-900 underline mt-1 inline-block">
              Upgrade your plan →
            </a>
          </div>
        )}

        {error && !qbrLimitReached && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Generate button */}
        <button
          onClick={generate}
          disabled={loading || qbrLimitReached}
          className={qbrLimitReached ? 'btn-secondary w-full py-3 text-sm opacity-60 cursor-not-allowed' : 'btn-primary w-full py-3 text-sm'}
        >
          {loading ? (
            <span className="flex items-center gap-2 justify-center">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Generating QBR...
            </span>
          ) : qbrLimitReached ? (
            'Upgrade to Generate More QBRs'
          ) : (
            <><Zap size={16} /> Generate QBR with AI</>
          )}
        </button>

      </div>
    </div>
  )
}