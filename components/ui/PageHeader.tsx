import type { ReactNode } from 'react'

// Presentation-only page heading. Takes display content and nothing else:
// no data fetching, no permission checks, no routing. Callers pass any
// already-computed text as `description`.
export function PageHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <header className="qd-page-header">
      <div className="min-w-0">
        <h1 className="qd-page-title">{title}</h1>
        {description != null && <p className="qd-page-subtitle">{description}</p>}
      </div>
    </header>
  )
}
