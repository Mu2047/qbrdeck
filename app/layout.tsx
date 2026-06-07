import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

export const metadata: Metadata = {
  title: 'QBR Deck — by MI Secure Tech Solutions',
  description: 'Generate professional Quarterly Business Review decks for your MSP clients in minutes.',
  keywords: 'MSP, QBR, quarterly business review, managed service provider, IT report',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="antialiased">{children}</body>
      </html>
    </ClerkProvider>
  )
}
