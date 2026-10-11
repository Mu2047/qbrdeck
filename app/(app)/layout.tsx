'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { UserButton, useAuth } from '@clerk/nextjs'
import { LayoutDashboard, Users, Settings, CreditCard, FileText, BarChart2 } from 'lucide-react'
import { markActiveWorkspace } from '@/lib/switcher-state'

const NAV = [
  { href: '/dashboard',           icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/dashboard/clients',   icon: Users,           label: 'Clients'   },
  { href: '/dashboard/analytics', icon: BarChart2,       label: 'Analytics' },
  { href: '/dashboard/billing',   icon: CreditCard,      label: 'Billing'   },
  { href: '/dashboard/settings',  icon: Settings,        label: 'Settings'  },
]

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Owner', ADMIN: 'Admin', MEMBER: 'Member', VIEWER: 'Viewer',
}

type WorkspaceOption = { workspaceId: string; name: string; role: string; active: boolean }

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const router = useRouter()
  const { isLoaded, isSignedIn } = useAuth()

  // Switcher data — fetched client-side (same convention as Settings/
  // Billing elsewhere in app/(app)), not prop-drilled from a server
  // component. A single-workspace user never sees more than an empty list
  // resolve to "show nothing" below, so this has no visible effect for them
  // beyond one extra lightweight request.
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([])
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState('')

  useEffect(() => {
    // Wait for Clerk to resolve the signed-in state before asking the
    // server for anything. This is a client-side readiness gate only — the
    // server route still independently re-checks auth() itself; this never
    // substitutes for that. Without it, the request could fire during the
    // brief window before ClerkJS finishes hydrating, race to a non-200
    // response, and — since this effect used to run exactly once with no
    // dependencies — never get a second chance to try again.
    if (!isLoaded || !isSignedIn) return

    let cancelled = false

    fetch('/api/workspace/active', { credentials: 'same-origin', cache: 'no-store' })
      .then(res => {
        // fetch() only rejects on a network failure — an HTTP error status
        // with a valid JSON body (e.g. a 401) resolves normally, so without
        // this check a non-200 response was silently parsed as if it were
        // success and quietly produced an empty workspace list forever.
        if (!res.ok) throw new Error(`workspace list request failed: ${res.status}`)
        return res.json()
      })
      .then(data => {
        if (!cancelled) setWorkspaces(data.workspaces ?? [])
      })
      .catch(() => {
        // Non-fatal: the switcher just stays hidden, identical to a
        // single-workspace user — never a broken/partial selector, never a
        // crashed layout, and nothing sensitive surfaced. If isLoaded/
        // isSignedIn later change (e.g. a sign-out/sign-in within the same
        // tab), the effect re-runs and gets a fresh chance.
        if (!cancelled) setWorkspaces([])
      })

    return () => { cancelled = true }
  }, [isLoaded, isSignedIn])

  const activeWorkspaceId = workspaces.find(w => w.active)?.workspaceId ?? ''

  async function switchWorkspace(workspaceId: string) {
    if (!workspaceId || workspaceId === activeWorkspaceId) return
    setSwitching(true)
    setSwitchError('')
    try {
      const res = await fetch('/api/workspace/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setSwitchError(data.error ?? 'Could not switch workspace.')
        setSwitching(false)
        return
      }
      // router.refresh() re-renders Server Components but does not remount
      // this client layout, so the list fetched above is never re-read and
      // would keep showing the old workspace as active. Update it here, now
      // that the server has accepted the switch.
      setWorkspaces(prev => markActiveWorkspace(prev, workspaceId))
      setSwitching(false)
      // Navigate to the dashboard root — a nested page (e.g. a specific
      // client) may not exist in the newly active workspace — then refresh
      // so every server-rendered workspace-scoped value re-fetches under
      // the new cookie.
      router.push('/dashboard')
      router.refresh()
    } catch {
      setSwitchError('Could not switch workspace.')
      setSwitching(false)
    }
  }

  return (
    // h-screen (not min-h-screen) caps this row at exactly the viewport
    // height instead of letting it grow taller when main content is tall.
    // Without that cap, <main>'s overflow-auto has no bounded height to
    // scroll within, so tall page content grows the whole row — and the
    // sidebar, stretching by default to match the row's height — right
    // along with it, pushing the switcher/Account footer far down the page
    // instead of keeping them pinned in view.
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 h-screen flex-shrink-0 bg-navy-800 flex flex-col">
        {/* Logo */}
        <div className="h-16 shrink-0 flex items-center px-5 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-gold-500 rounded-md flex items-center justify-center">
              <FileText size={14} className="text-white" />
            </div>
            <div>
              <div className="text-white text-sm font-semibold leading-none">QBR Deck</div>
              <div className="text-white/40 text-[10px] mt-0.5">MI Secure Tech</div>
            </div>
          </div>
        </div>

        {/* Nav — min-h-0 is required alongside flex-1: a flex item's default
            min-height is "auto" (at least its content's natural height),
            which on its own would silently block overflow-y-auto from ever
            engaging. With it, nav scrolls internally on a short viewport
            instead of pushing the switcher/Account footer below it. */}
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-1">
          {NAV.map(({ href, icon: Icon, label }) => {
            const active = path === href || (href !== '/dashboard' && path.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  active
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
              >
                <Icon size={16} />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Workspace switcher — only ever rendered once 2+ memberships are
            confirmed, so a single-workspace user sees no selector at all,
            and no empty gap either (the conditional renders nothing). */}
        {workspaces.length > 1 && (
          <div className="px-4 pt-3 shrink-0">
            <label htmlFor="workspace-switcher" className="sr-only">Switch workspace</label>
            <select
              id="workspace-switcher"
              className="w-full bg-white/10 text-white text-xs rounded-lg px-2 py-2 border border-white/10 disabled:opacity-60"
              value={activeWorkspaceId}
              disabled={switching}
              onChange={e => switchWorkspace(e.target.value)}
            >
              {workspaces.map(w => (
                <option key={w.workspaceId} value={w.workspaceId} className="text-navy-800">
                  {w.name} — {ROLE_LABEL[w.role] ?? w.role}
                </option>
              ))}
            </select>
            {switchError && (
              <p className="text-red-300 text-[11px] mt-1">{switchError}</p>
            )}
          </div>
        )}

        {/* User */}
        <div className="p-4 shrink-0 border-t border-white/10 flex items-center gap-3">
          <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: 'w-8 h-8' } }} />
          <div className="text-white/60 text-xs">Account</div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
