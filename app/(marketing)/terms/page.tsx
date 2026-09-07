import { LegalPageLayout, LegalSection } from '../_components/legal-page-layout'

export const metadata = {
  title: 'Terms of Service — QBR Deck',
}

export default function TermsOfServicePage() {
  return (
    <LegalPageLayout title="Terms of Service" effectiveDate="September 6, 2026">
      <LegalSection heading="1. Acceptance of terms">
        <p>
          These Terms of Service ("Terms") govern your access to and use of QBR Deck, a
          product operated by MI Secure Tech Solutions ("QBR Deck," "we," "us," or "our").
          By creating an account or otherwise using QBR Deck, you agree to these Terms.
        </p>
      </LegalSection>

      <LegalSection heading="2. Description of the service">
        <p>
          QBR Deck is a software-as-a-service productivity platform that helps managed
          service providers (MSPs) and similar businesses produce, manage, and export
          Quarterly Business Review ("QBR") content for their clients.
        </p>
      </LegalSection>

      <LegalSection heading="3. Account responsibility">
        <p>
          You are responsible for maintaining the confidentiality of your account
          credentials and for all activity that occurs under your account. Notify us
          promptly of any unauthorized use of your account.
        </p>
      </LegalSection>

      <LegalSection heading="4. Authorized and business use">
        <p>
          QBR Deck is intended for authorized business and professional use by MSPs and
          similar organizations and their team members. You may not use QBR Deck on
          behalf of an organization you are not authorized to represent.
        </p>
      </LegalSection>

      <LegalSection heading="5. Your content">
        <p>
          You retain ownership of the client information, metrics, and other content you
          submit to QBR Deck ("Customer Content"). You grant us the rights reasonably
          necessary to host, process, display, generate, and export Customer Content
          solely in order to provide the service to you.
        </p>
      </LegalSection>

      <LegalSection heading="6. AI-generated content">
        <p>
          QBR Deck uses AI to help generate parts of your QBR decks. AI-generated output
          may contain errors, omissions, or inaccuracies. You are responsible for
          reviewing all AI-generated content before relying on it or presenting it to a
          client. QBR Deck does not guarantee the factual accuracy of AI-generated output.
        </p>
      </LegalSection>

      <LegalSection heading="7. Acceptable use">
        <p>You agree not to use QBR Deck to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Violate any applicable law or regulation;</li>
          <li>Abuse, harass, or interfere with the security or integrity of the service;</li>
          <li>Attempt to gain unauthorized access to any account, system, or data;</li>
          <li>Upload or transmit malware or other harmful code;</li>
          <li>Infringe the intellectual property or other rights of any third party; or</li>
          <li>Attempt to disrupt or degrade the availability of the service.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="8. Subscriptions and plans">
        <p>
          QBR Deck offers a Free plan and paid subscription plans (currently Solo, Growth,
          and Agency). Features and usage limits differ by plan and are described on our
          pricing and billing pages.
        </p>
      </LegalSection>

      <LegalSection heading="9. Billing and automatic renewal">
        <p>
          Paid subscriptions are billed monthly in advance and renew automatically each
          billing period until canceled. Payment processing is handled by Stripe. QBR Deck
          does not store your full card number.
        </p>
      </LegalSection>

      <LegalSection heading="10. Cancellation">
        <p>
          You may cancel your paid subscription at any time through the Stripe Customer
          Portal. Cancellation takes effect at the end of your current billing period, and
          you retain access to your plan's paid features until that period ends.
        </p>
      </LegalSection>

      <LegalSection heading="11. Refunds">
        <p>
          Payments are generally non-refundable and we do not provide prorated refunds or
          credits for partially used billing periods, except where required by applicable
          law.
        </p>
      </LegalSection>

      <LegalSection heading="12. Plan limits and features">
        <p>
          Plan limits (such as the number of clients, QBRs, exports, or team members) and
          available features differ by subscription tier and are subject to change on a
          going-forward basis, as described on our pricing and billing pages.
        </p>
      </LegalSection>

      <LegalSection heading="13. Taxes">
        <p>
          Fees are exclusive of applicable taxes unless stated otherwise. You are
          responsible for any taxes associated with your purchase, other than taxes on our
          net income.
        </p>
      </LegalSection>

      <LegalSection heading="14. Third-party services">
        <p>
          QBR Deck relies on third-party service providers, including Stripe (payments),
          Clerk (authentication), Supabase (database hosting), Vercel and Vercel Blob
          (application and file hosting), Anthropic (AI processing), and Resend (email
          delivery), to operate the service.
        </p>
      </LegalSection>

      <LegalSection heading="15. Availability and changes to the service">
        <p>
          We aim to keep QBR Deck available and reliable, but we do not guarantee
          uninterrupted availability and do not provide an uptime service-level
          commitment. We may modify or update features of the service from time to time.
        </p>
      </LegalSection>

      <LegalSection heading="16. Intellectual property">
        <p>
          QBR Deck, its software, branding, and underlying technology are owned by MI
          Secure Tech Solutions. Except for the rights expressly granted to you to use the
          service, we reserve all rights, title, and interest in QBR Deck.
        </p>
      </LegalSection>

      <LegalSection heading="17. Disclaimers">
        <p>
          QBR Deck is provided "as is" and "as available" without warranties of any kind,
          express or implied, including warranties of merchantability, fitness for a
          particular purpose, and non-infringement. We do not warrant that the service, or
          any AI-generated output, will be error-free or uninterrupted.
        </p>
      </LegalSection>

      <LegalSection heading="18. Limitation of liability">
        <p>
          To the maximum extent permitted by law, QBR Deck and MI Secure Tech Solutions
          will not be liable for any indirect, incidental, special, consequential, or
          punitive damages, or for any loss of profits, data, or business, arising out of
          or relating to your use of the service.
        </p>
      </LegalSection>

      <LegalSection heading="19. Termination">
        <p>
          We may suspend or terminate your access to QBR Deck for material breach of these
          Terms, including non-payment or abuse of the service, with notice where
          reasonably practicable.
        </p>
      </LegalSection>

      <LegalSection heading="20. Effect of cancellation or termination">
        <p>
          When a paid subscription ends — whether by cancellation or otherwise — your paid
          plan access continues until the end of the current billing period, after which
          your workspace may revert to the Free plan. Ending a paid subscription does not,
          by itself, automatically delete your existing client or QBR content.
        </p>
      </LegalSection>

      <LegalSection heading="21. Changes to these terms">
        <p>
          We may update these Terms from time to time. If we make material changes, we
          will update the effective date above.
        </p>
      </LegalSection>

      <LegalSection heading="22. Contact">
        <p>
          Questions about these Terms can be sent to{' '}
          <a href="mailto:support@misecuretechsolutions.com" className="text-navy-700 underline">
            support@misecuretechsolutions.com
          </a>.
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
