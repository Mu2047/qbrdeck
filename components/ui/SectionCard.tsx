import type { ReactNode } from 'react'

// Presentation-only dashboard section surface: header (title, optional
// description, optional action slot) above a flush body. No data fetching,
// permissions, or routing — callers decide what goes in `action` (including
// any permission gate) and pass it in already resolved. A falsy `action`
// (e.g. `false` from a `{canX && (...)}` expression) renders nothing.
export function SectionCard({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`qd-surface overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-gray-100">
        <div className="min-w-0">
          <h2 className="qd-section-title">{title}</h2>
          {description != null && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}
