'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'
import { LayoutDashboard, Users, Settings, CreditCard, FileText, BarChart2 } from 'lucide-react'

const NAV = [
  { href: '/dashboard',           icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/dashboard/clients',   icon: Users,           label: 'Clients'   },
  { href: '/dashboard/analytics', icon: BarChart2,       label: 'Analytics' },
  { href: '/dashboard/billing',   icon: CreditCard,      label: 'Billing'   },
  { href: '/dashboard/settings',  icon: Settings,        label: 'Settings'  },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname()

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-navy-800 flex flex-col">
        {/* Logo */}
        <div className="h-16 flex items-center px-5 border-b border-white/10">
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

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
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

        {/* User */}
        <div className="p-4 border-t border-white/10 flex items-center gap-3">
          <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: 'w-8 h-8' } }} />
          <div className="text-white/60 text-xs">Account</div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
