import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'

export default async function PortalPage({ params }: { params: { token: string } }) {
  const qbr = await prisma.qBR.findUnique({
    where: { shareToken: params.token },
    include: { client: { include: { workspace: { include: { subscription: true } } } } },
  })

  if (!qbr || !qbr.slides) notFound()

  const slides = qbr.slides as any[]
  const plan = qbr.client.workspace.subscription?.plan ?? 'FREE'
  const isWhiteLabel = plan === 'GROWTH' || plan === 'AGENCY'

  const statusColor = (s: string) =>
    s === 'good'    ? 'bg-green-50 border-green-200' :
    s === 'caution' ? 'bg-amber-50 border-amber-200' :
    'bg-red-50 border-red-200'

  const statusLabel = (s: string) =>
    s === 'good'    ? 'On track' :
    s === 'caution' ? 'Monitor'  :
    'Needs attention'

  const statusText = (s: string) =>
    s === 'good'    ? 'text-green-600' :
    s === 'caution' ? 'text-amber-600' :
    'text-red-600'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#0a1634] px-8 py-5 flex items-center justify-between">
        <div>
          <p className="text-[#c9a02a] text-xs tracking-widest uppercase mb-1">Quarterly Business Review</p>
          <h1 className="text-white text-xl font-bold">{qbr.client.name} — Q{qbr.quarter} {qbr.year}</h1>
        </div>
        <p className="text-white/40 text-xs">Confidential</p>
      </div>
      <div className="h-0.5 bg-[#c9a02a]" />

      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        {slides.map((slide: any, i: number) => (
          <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="bg-[#0a1634] px-6 py-3 flex items-center justify-between">
              <p className="text-white text-sm font-medium">{slide.title}</p>
              <span className="text-white/40 text-xs">Slide {i + 2}</span>
            </div>
            <div className="p-6">
              <p className="text-gray-600 text-sm leading-relaxed mb-4">{slide.content}</p>
              {slide.type === 'metrics' && slide.metrics && (
                <div className="grid grid-cols-3 gap-3">
                  {slide.metrics.map((m: any, j: number) => (
                    <div key={j} className={`rounded-lg p-3.5 border ${statusColor(m.status)}`}>
                      <p className="text-xs text-gray-500 mb-1">{m.label}</p>
                      <p className="text-xl font-bold text-[#0a1634] mb-1">{m.value}</p>
                      <p className={`text-xs font-medium ${statusText(m.status)}`}>{statusLabel(m.status)}</p>
                    </div>
                  ))}
                </div>
              )}
              {slide.bullets && (
                <div className="space-y-2.5">
                  {slide.bullets.map((b: string, j: number) => (
                    <div key={j} className="flex items-start gap-2.5">
                      <div className="w-0.5 h-5 bg-[#c9a02a] flex-shrink-0 mt-1 rounded-full" />
                      <p className="text-sm text-gray-700">{b}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {!isWhiteLabel && (
          <p className="text-center text-xs text-gray-400 pt-4">Powered by QBR Deck</p>
        )}
      </div>
    </div>
  )
}