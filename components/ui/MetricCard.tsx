import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

// Presentation-only KPI tile. Renders exactly the values it is given — no
// data fetching, no permission or plan logic, no routing. Any formatting of
// the value is the caller's responsibility.

type MetricAccent = 'neutral' | 'gold' | 'warning'

const ICON_ACCENT: Record<MetricAccent, string> = {
  neutral: 'bg-gray-50 text-gray-500 ring-gray-200',
  gold:    'bg-gold-50 text-gold-600 ring-gold-200',
  warning: 'bg-amber-50 text-amber-600 ring-amber-200',
}

export function MetricCard({
  label,
  value,
  helper,
  icon: Icon,
  accent = 'neutral',
}: {
  label: ReactNode
  value: ReactNode
  helper?: ReactNode
  icon?: LucideIcon
  accent?: MetricAccent
}) {
  return (
    <div className="qd-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="qd-metric-label pt-0.5">{label}</p>
        {Icon && (
          <span
            aria-hidden="true"
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${ICON_ACCENT[accent]}`}
          >
            <Icon size={14} />
          </span>
        )}
      </div>
      <p className="qd-metric-value mt-1.5">{value}</p>
      {helper != null && <p className="mt-1 text-xs text-gray-500">{helper}</p>}
    </div>
  )
}
