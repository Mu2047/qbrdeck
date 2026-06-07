'use client'

import { useState, useEffect, useRef } from 'react'
import { useUser } from '@clerk/nextjs'
import { ManageSubscriptionButton } from '@/app/(app)/dashboard/billing/billing-button'
import { Users, Mail, Shield, Trash2, ChevronDown } from 'lucide-react'

const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const
type Role = typeof ROLES[number]

const ROLE_LABELS: Record<Role, { label: string; description: string }> = {
  OWNER:  { label: 'Owner',  description: 'Full access including billing' },
  ADMIN:  { label: 'Admin',  description: 'Manage clients and QBRs' },
  MEMBER: { label: 'Member', description: 'Generate and view QBRs' },
  VIEWER: { label: 'Viewer', description: 'View only' },
}

export default function SettingsPage() {
  const { user } = useUser()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState<'general' | 'team'>('general')

  // General settings state
  const [companyName, setCompanyName]     = useState('')
  const [saving, setSaving]               = useState(false)
  const [saved, setSaved]                 = useState(false)
  const [logoUrl, setLogoUrl]             = useState<string | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoError, setLogoError]         = useState('')
  const [plan, setPlan]                   = useState<string>('FREE')
  const [subscription, setSubscription]   = useState<any>(null)
  const [subLoading, setSubLoading]       = useState(true)

  // Team state
  const [currentRole, setCurrentRole]   = useState<Role>('MEMBER')
  const [members, setMembers]           = useState<any[]>([])
  const [invites, setInvites]           = useState<any[]>([])
  const [teamLoading, setTeamLoading]   = useState(true)
  const [inviteEmail, setInviteEmail]   = useState('')
  const [inviteRole, setInviteRole]     = useState<Role>('MEMBER')
  const [inviting, setInviting]         = useState(false)
  const [inviteError, setInviteError]   = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')

  useEffect(() => {
    fetch('/api/user')
      .then(r => r.json())
      .then(data => {
        setCompanyName(data.companyName ?? '')
        setLogoUrl(data.logoUrl ?? null)
      })

    fetch('/api/subscription')
      .then(r => r.json())
      .then((data: any) => {
        if (data?.subscription) {
          setSubscription(data.subscription)
          setPlan(data.subscription.plan)
        }
        setSubLoading(false)
      })
      .catch(() => setSubLoading(false))

    loadTeam()
  }, [])

  function loadTeam() {
    setTeamLoading(true)
    fetch('/api/workspace')
      .then(r => r.json())
      .then(data => {
        setMembers(data.members ?? [])
        setInvites(data.invites ?? [])
        setCurrentRole(data.currentRole ?? 'MEMBER')
        setTeamLoading(false)
      })
      .catch(() => setTeamLoading(false))
  }

  async function save() {
    setSaving(true)
    await fetch('/api/workspace', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: companyName }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoError(''); setLogoUploading(true)
    const form = new FormData()
    form.append('logo', file)
    try {
      const res  = await fetch('/api/upload-logo', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) setLogoError(data.error ?? 'Upload failed')
      else setLogoUrl(data.url)
    } catch {
      setLogoError('Upload failed. Try again.')
    } finally {
      setLogoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) { setInviteError('Email is required'); return }
    setInviting(true); setInviteError(''); setInviteSuccess('')
    try {
      const res  = await fetch('/api/workspace/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === 'SEAT_LIMIT_REACHED') {
          setInviteError(data.message)
        } else {
          setInviteError(data.error ?? 'Failed to send invite')
        }
      } else {
        setInviteSuccess(`Invitation sent to ${inviteEmail.trim()}`)
        setInviteEmail('')
        loadTeam()
      }
    } catch {
      setInviteError('Failed to send invite')
    } finally {
      setInviting(false)
    }
  }

  async function revokeInvite(inviteId: string) {
    await fetch('/api/workspace/invite', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteId }),
    })
    loadTeam()
  }

  async function removeMember(memberId: string) {
    if (!confirm('Remove this team member?')) return
    await fetch('/api/workspace/members', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId }),
    })
    loadTeam()
  }

  async function changeRole(memberId: string, role: Role) {
    await fetch('/api/workspace/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, role }),
    })
    loadTeam()
  }

  const isOwner = currentRole === 'OWNER'

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-800">Settings</h1>
        <p className="text-gray-500 text-sm mt-1">Manage your workspace and team.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-100">
        {(['general', 'team'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors capitalize ${
              activeTab === tab
                ? 'text-navy-800 border-b-2 border-navy-800 -mb-px'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {tab === 'team' ? (
              <span className="flex items-center gap-1.5"><Users size={14} /> Team</span>
            ) : tab}
          </button>
        ))}
      </div>

      {/* ── General Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'general' && (
        <div className="space-y-6">
          <div className="card p-6 space-y-5">
            {/* Logo */}
            <div>
              <label className="label">Company logo <span className="text-gray-400 font-normal">(appears on all QBR exports)</span></label>
              <div className="flex items-center gap-4 mt-2">
                <div className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50 overflow-hidden flex-shrink-0">
                  {logoUrl
                    ? <img src={logoUrl} alt="Logo" className="w-full h-full object-contain p-1" />
                    : <span className="text-gray-300 text-xs text-center px-1">No logo</span>}
                </div>
                <div className="space-y-1.5">
                  <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={handleLogoUpload} />
                  <button onClick={() => fileInputRef.current?.click()} disabled={logoUploading || !isOwner} className="btn-secondary text-sm px-4 py-2">
                    {logoUploading ? 'Uploading...' : logoUrl ? 'Change logo' : 'Upload logo'}
                  </button>
                  {!isOwner && <p className="text-xs text-gray-400">Only the workspace owner can change the logo.</p>}
                  <p className="text-xs text-gray-400">PNG, JPG, SVG or WebP — max 2MB</p>
                  {logoError && <p className="text-red-500 text-xs">{logoError}</p>}
                </div>
              </div>
            </div>

            <div>
              <label className="label">Your name</label>
              <input className="input" value={user?.fullName ?? ''} disabled />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" value={user?.emailAddresses[0]?.emailAddress ?? ''} disabled />
            </div>
            <div>
              <label className="label">Workspace name <span className="text-gray-400 font-normal">(used inside your workspace)</span></label>
              {isOwner && (plan !== 'GROWTH' && plan !== 'AGENCY') && (
                <p className="text-xs text-gray-400 mt-1">Client-facing white-label branding is available on Growth and Agency plans.</p>
              )}
              <input className="input" placeholder="Your MSP company name" value={companyName} onChange={e => setCompanyName(e.target.value)} disabled={!isOwner} />
              {!isOwner && <p className="text-xs text-gray-400 mt-1">Only the workspace owner can update the workspace name.</p>}
            </div>
            {isOwner && (
              <button onClick={save} disabled={saving} className="btn-primary w-full py-3 text-sm">
                {saving ? 'Saving...' : saved ? 'Saved!' : 'Save settings'}
              </button>
            )}
          </div>

          {/* White-label */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-semibold text-navy-800">White-label branding</h2>
              {(plan === 'GROWTH' || plan === 'AGENCY')
                ? <span className="badge-green text-xs">Active</span>
                : <span className="badge-gray text-xs">Growth & Agency</span>}
            </div>
            {(plan === 'GROWTH' || plan === 'AGENCY') ? (
              <ul className="text-sm text-gray-500 space-y-1">
                <li>✓ Your logo on PDF and PPTX exports</li>
                <li>✓ Your company name on all slide headers</li>
                <li>✓ "Powered by QBR Deck" removed from client portal</li>
              </ul>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">Remove QBR Deck branding and replace with your own logo and company name.</p>
                <a href="/dashboard/billing" className="btn-primary text-sm py-2 px-4 inline-block">Upgrade to Growth</a>
              </div>
            )}
          </div>

          {/* Billing */}
          {!subLoading && subscription && isOwner && (
            <div className="card p-6 space-y-4">
              <h2 className="text-lg font-semibold text-navy-800">Billing & Plan</h2>
              <p className="text-gray-500 text-sm">Current plan: <span className="font-medium text-navy-800">{subscription.plan}</span></p>
              {subscription.plan === 'FREE' && (
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">QBRs generated</span>
                      <span className="font-medium text-navy-800">{subscription.qbrCount ?? 0} / 3</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div className="bg-gold-500 h-1.5 rounded-full" style={{ width: `${Math.min(((subscription.qbrCount ?? 0) / 3) * 100, 100)}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">QBR packages exported</span>
                      <span className="font-medium text-navy-800">{subscription.exportCount ?? 0} / 3</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div className="bg-gold-500 h-1.5 rounded-full" style={{ width: `${Math.min(((subscription.exportCount ?? 0) / 3) * 100, 100)}%` }} />
                    </div>
                  </div>
                </div>
              )}
              <ManageSubscriptionButton />
            </div>
          )}
        </div>
      )}

      {/* ── Team Tab ─────────────────────────────────────────────────────────── */}
      {activeTab === 'team' && (
        <div className="space-y-6">

          {/* Invite form — Owner only */}
          {isOwner && (
            <div className="card p-6">
              <h2 className="text-sm font-semibold text-navy-800 mb-4 flex items-center gap-2">
                <Mail size={15} className="text-gray-400" /> Invite team member
              </h2>
              {(plan === 'FREE' || plan === 'SOLO') ? (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                  <p className="text-sm text-amber-800 font-medium">Team access requires Growth plan</p>
                  <p className="text-sm text-amber-700 mt-1">Upgrade to invite team members and collaborate on client QBRs.</p>
                  <a href="/dashboard/billing" className="text-sm font-medium text-amber-900 underline mt-2 inline-block">Upgrade to Growth →</a>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Email address</label>
                      <input className="input" type="email" placeholder="colleague@company.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Role</label>
                      <select className="input" value={inviteRole} onChange={e => setInviteRole(e.target.value as Role)}>
                        {(['ADMIN', 'MEMBER', 'VIEWER'] as Role[]).map(r => (
                          <option key={r} value={r}>{ROLE_LABELS[r].label} — {ROLE_LABELS[r].description}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {inviteError && <p className="text-red-500 text-sm">{inviteError}</p>}
                  {inviteSuccess && <p className="text-green-600 text-sm">{inviteSuccess}</p>}
                  <button onClick={sendInvite} disabled={inviting} className="btn-primary text-sm py-2 px-4">
                    {inviting ? 'Sending...' : 'Send invitation'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Members list */}
          <div className="card">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-navy-800 flex items-center gap-2">
                <Users size={15} className="text-gray-400" /> Team members
              </h2>
            </div>
            {teamLoading ? (
              <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {members.map(m => (
                  <div key={m.id} className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-navy-100 flex items-center justify-center text-navy-700 text-sm font-bold">
                        {(m.name ?? m.email).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-navy-800">{m.name ?? '—'}</p>
                        <p className="text-xs text-gray-400">{m.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isOwner && m.role !== 'OWNER' ? (
                        <select
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-navy-800"
                          value={m.role}
                          onChange={e => changeRole(m.id, e.target.value as Role)}
                        >
                          {(['ADMIN', 'MEMBER', 'VIEWER'] as Role[]).map(r => (
                            <option key={r} value={r}>{ROLE_LABELS[r].label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">
                          {ROLE_LABELS[m.role as Role]?.label ?? m.role}
                        </span>
                      )}
                      {isOwner && m.role !== 'OWNER' && (
                        <button onClick={() => removeMember(m.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending invites */}
          {invites.length > 0 && (
            <div className="card">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-navy-800">Pending invitations</h2>
              </div>
              <div className="divide-y divide-gray-50">
                {invites.map(inv => (
                  <div key={inv.id} className="flex items-center justify-between p-4">
                    <div>
                      <p className="text-sm font-medium text-navy-800">{inv.email}</p>
                      <p className="text-xs text-gray-400">{ROLE_LABELS[inv.role as Role]?.label} · Expires {new Date(inv.expiresAt).toLocaleDateString()}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-600 font-medium">Pending</span>
                      {isOwner && (
                        <button onClick={() => revokeInvite(inv.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Role guide */}
          <div className="card p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Shield size={12} /> Role permissions
            </h3>
            <div className="space-y-2">
              {(Object.entries(ROLE_LABELS) as [Role, { label: string; description: string }][]).map(([role, info]) => (
                <div key={role} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-navy-800">{info.label}</span>
                  <span className="text-gray-400 text-xs">{info.description}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}