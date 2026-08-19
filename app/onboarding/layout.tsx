import { FileText } from 'lucide-react'

// Additive-only onboarding chrome. Deliberately does not import or reuse
// app/(app)/layout.tsx — no dashboard sidebar/nav, no billing-interception
// logic, nothing shared with the gated product shell.
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-12">
      <div className="flex items-center gap-2.5 mb-8">
        <div className="w-7 h-7 bg-gold-500 rounded-md flex items-center justify-center">
          <FileText size={14} className="text-white" />
        </div>
        <div className="text-navy-800 text-sm font-semibold">QBR Deck</div>
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}
