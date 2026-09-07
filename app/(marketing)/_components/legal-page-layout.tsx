import Link from 'next/link'

export function LegalPageLayout({
  title,
  effectiveDate,
  children,
}: {
  title: string
  effectiveDate: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-100 bg-white/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center">
              <span className="text-gold-300 text-xs font-bold">QBR</span>
            </div>
            <div>
              <span className="font-semibold text-navy-800 text-sm">QBR Deck</span>
              <span className="text-gray-400 text-xs ml-1.5">by MI Secure Tech Solutions</span>
            </div>
          </Link>
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">Back to home</Link>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-navy-800 mb-2">{title}</h1>
        <p className="text-gray-400 text-sm mb-10">Effective date: {effectiveDate}</p>
        <div className="prose-legal space-y-8 text-gray-700 text-sm leading-relaxed">
          {children}
        </div>
      </main>

      <footer className="border-t border-gray-100 py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-sm text-gray-400">
            © {new Date().getFullYear()} MI Secure Tech Solutions. All rights reserved.
          </div>
          <div className="flex items-center gap-6 text-sm text-gray-400">
            <Link href="/privacy" className="hover:text-gray-700">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-700">Terms</Link>
            <a href="mailto:support@misecuretechsolutions.com" className="hover:text-gray-700">Support</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-navy-800 mb-3">{heading}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}
