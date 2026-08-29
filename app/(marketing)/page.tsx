import Link from 'next/link'
import { SignedIn, SignedOut, SignInButton } from '@clerk/nextjs'
import { FileText, Zap, Download, Shield, Users, BarChart3, Check, ArrowRight, Star } from 'lucide-react'

const FEATURES = [
  { icon: Zap, title: 'AI-generated in seconds', desc: 'Paste your metrics. Claude AI writes executive-grade slides your clients will respect.' },
  { icon: Download, title: 'PPTX + PDF export', desc: 'Download branded PowerPoint files or PDFs ready to present or email instantly.' },
  { icon: Shield, title: 'Built for MSPs', desc: 'Designed around how MSPs actually work — tickets, uptime, patches, security, wins.' },
  { icon: Users, title: 'Multi-client dashboard', desc: 'Manage all your QBRs across every client in one organized workspace.' },
  { icon: BarChart3, title: 'Metrics that make sense', desc: 'Traffic-light statuses and plain-English summaries clients can actually understand.' },
  { icon: FileText, title: 'History & version control', desc: 'Every QBR saved. Pull up last quarter in one click during renewal conversations.' },
]

const PLANS = [
  {
    name: 'Solo',
    price: 49,
    desc: 'Perfect for solo MSPs getting started',
    features: ['Up to 10 clients', '20 QBRs per month', 'PDF + PPTX export', 'Email support'],
    cta: 'Get started',
    popular: false,
  },
  {
    name: 'Growth',
    price: 99,
    desc: 'For growing MSPs with multiple clients',
    features: ['Up to 50 clients', 'Unlimited QBRs', 'PDF + PPTX export', 'White-label branding', 'Priority support'],
    cta: 'Get started',
    popular: true,
  },
  {
    name: 'Agency',
    price: 199,
    desc: 'For established MSPs at scale',
    features: ['Unlimited clients', 'Unlimited QBRs', 'PDF + PPTX export', 'White-label branding', 'Priority support'],
    cta: 'Get started',
    popular: false,
  },
]

const TESTIMONIALS = [
  { quote: 'We used to spend half a day on each QBR. Now it takes 10 minutes. Our clients think we upgraded our whole reporting stack.', name: 'James Okafor', role: 'Owner, Pinnacle IT Services' },
  { quote: "The decks look better than anything we were making manually. Closed two upsells in the first QBR cycle because the risks section was so clear.", name: 'Sara Mendez', role: 'Account Manager, BrightPath MSP' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100 bg-white/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center">
              <span className="text-gold-300 text-xs font-bold">QBR</span>
            </div>
            <div>
              <span className="font-semibold text-navy-800 text-sm">QBR Deck</span>
              <span className="text-gray-400 text-xs ml-1.5">by MI Secure Tech Solutions</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link href="#pricing" className="text-sm text-gray-500 hover:text-gray-900">Pricing</Link>
            <SignedOut>
              <SignInButton mode="modal">
                <button className="text-sm text-gray-500 hover:text-gray-900">Sign in</button>
              </SignInButton>
              <Link href="/sign-up" className="btn-primary text-sm">
                Get started free
              </Link>
            </SignedOut>
            <SignedIn>
              <Link href="/dashboard" className="btn-primary text-sm">
                Go to dashboard <ArrowRight size={14} />
              </Link>
            </SignedIn>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="bg-navy-800 text-white">
        <div className="max-w-4xl mx-auto px-6 py-24 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 rounded-full px-4 py-1.5 text-sm mb-8">
            <Star size={12} className="text-gold-300" />
            <span className="text-gray-200">Purpose-built for MSPs</span>
          </div>
          <h1 className="text-5xl font-bold leading-tight mb-6">
            Client QBRs that take
            <span className="text-gold-300"> minutes,</span>
            <br />not half a day.
          </h1>
          <p className="text-xl text-gray-300 max-w-2xl mx-auto mb-10 leading-relaxed">
            Paste your metrics. Our AI generates a polished, branded Quarterly Business Review deck
            your clients will actually read — ready to export as PPTX or PDF.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/sign-up" className="btn-gold px-8 py-3.5 text-base">
              Start free — no card required
            </Link>
            <Link href="#features" className="text-gray-300 hover:text-white text-sm flex items-center gap-1">
              See how it works <ArrowRight size={14} />
            </Link>
          </div>
          <p className="text-gray-500 text-sm mt-6">Cancel anytime · No setup fees</p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 bg-gray-50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-navy-800 mb-4">Everything you need to run great QBRs</h2>
            <p className="text-gray-500 max-w-xl mx-auto">Stop spending hours in PowerPoint. Start showing up to every QBR with a deck that looks like your team worked on it all week.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="card p-6">
                <div className="w-10 h-10 bg-navy-50 rounded-lg flex items-center justify-center mb-4">
                  <f.icon size={20} className="text-navy-700" />
                </div>
                <h3 className="font-semibold text-navy-800 mb-2">{f.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-navy-800 mb-4">From metrics to deck in three steps</h2>
          </div>
          <div className="space-y-8">
            {[
              { step: '01', title: 'Add your client', desc: 'Set up client profiles once — name, industry, contacts, user count. Reuse every quarter.' },
              { step: '02', title: 'Enter this quarter\'s metrics', desc: 'Paste in tickets, uptime, patches, incidents, wins, and risks. Takes about 3 minutes.' },
              { step: '03', title: 'Generate, preview, export', desc: 'AI writes the full deck. Review the slides, then download as PPTX or PDF. Done.' },
            ].map((item) => (
              <div key={item.step} className="flex gap-6 items-start">
                <div className="w-12 h-12 rounded-xl bg-navy-800 text-gold-300 font-bold text-sm flex items-center justify-center flex-shrink-0">{item.step}</div>
                <div>
                  <h3 className="font-semibold text-navy-800 mb-1">{item.title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-16 bg-navy-800">
        <div className="max-w-4xl mx-auto px-6 grid md:grid-cols-2 gap-8">
          {TESTIMONIALS.map((t) => (
            <div key={t.name} className="bg-white/10 rounded-xl p-6">
              <p className="text-gray-200 text-sm leading-relaxed mb-5 italic">"{t.quote}"</p>
              <div>
                <p className="text-white text-sm font-medium">{t.name}</p>
                <p className="text-gray-400 text-xs">{t.role}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 bg-gray-50">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-navy-800 mb-4">Simple, transparent pricing</h2>
            <p className="text-gray-500">Start free. Upgrade when you're ready. Cancel anytime.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {PLANS.map((plan) => (
              <div key={plan.name} className={`card p-7 flex flex-col ${plan.popular ? 'ring-2 ring-navy-800 relative' : ''}`}>
                {plan.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="bg-navy-800 text-gold-300 text-xs font-medium px-3 py-1 rounded-full">Most popular</span>
                  </div>
                )}
                <div className="mb-5">
                  <h3 className="font-bold text-navy-800 text-lg">{plan.name}</h3>
                  <p className="text-gray-500 text-xs mt-1">{plan.desc}</p>
                </div>
                <div className="mb-6">
                  <span className="text-4xl font-bold text-navy-800">${plan.price}</span>
                  <span className="text-gray-400 text-sm">/month</span>
                </div>
                <ul className="space-y-2.5 mb-8 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm text-gray-600">
                      <Check size={15} className="text-green-500 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/sign-up" className={plan.popular ? 'btn-primary w-full justify-center' : 'btn-secondary w-full justify-center'}>
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 text-center">
        <div className="max-w-xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-navy-800 mb-4">Start impressing your clients today.</h2>
          <p className="text-gray-500 mb-8">Join MSPs already using QBR Deck to win renewals and upsell with confidence.</p>
          <Link href="/sign-up" className="btn-gold px-8 py-3.5 text-base">
            Get started — it's free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-sm text-gray-400">
            © {new Date().getFullYear()} MI Secure Tech Solutions. All rights reserved.
          </div>
          <div className="flex items-center gap-6 text-sm text-gray-400">
            <Link href="#" className="hover:text-gray-700">Privacy</Link>
            <Link href="#" className="hover:text-gray-700">Terms</Link>
            <a href="mailto:mcamara@misecuretechsolutions.com" className="hover:text-gray-700">Support</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
