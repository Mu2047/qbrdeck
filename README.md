# QBR Deck — by MI Secure Tech Solutions

AI-powered Quarterly Business Review generator for MSPs.
Generate branded PPTX and PDF decks from raw metrics in minutes.

---

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Auth**: Clerk
- **Database**: PostgreSQL via Supabase + Prisma
- **Payments**: Stripe
- **AI**: Anthropic Claude
- **PDF**: @react-pdf/renderer
- **PPTX**: pptxgenjs
- **Hosting**: Vercel

---

## Setup Instructions

### 1. Clone & Install

```bash
git clone <your-repo>
cd qbrdeck
npm install
```

### 2. Set Up Supabase (Free Database)

1. Go to https://supabase.com and create a new project
2. Go to Settings → Database → Connection String
3. Copy the **Transaction pooler** URL → set as `DATABASE_URL`
4. Copy the **Direct connection** URL → set as `DIRECT_URL`

### 3. Set Up Clerk (Auth)

1. Go to https://clerk.com and create an application
2. Enable Email/Google sign-in
3. Copy publishable key → `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
4. Copy secret key → `CLERK_SECRET_KEY`

### 4. Set Up Anthropic

1. Go to https://console.anthropic.com
2. Create an API key → `ANTHROPIC_API_KEY`

### 5. Set Up Stripe (Billing)

1. Go to https://dashboard.stripe.com
2. Create 3 products with monthly prices:
   - Solo: $49/month
   - Growth: $99/month
   - Agency: $199/month
3. Copy each price ID → `STRIPE_PRICE_SOLO`, `_GROWTH`, `_AGENCY`
4. Copy secret key → `STRIPE_SECRET_KEY`
5. Copy publishable key → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
6. Set up webhook at: `https://yourdomain.com/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
7. Copy webhook secret → `STRIPE_WEBHOOK_SECRET`

### 6. Configure Environment Variables

```bash
cp .env.example .env.local
# Fill in all values
```

### 7. Set Up Database

```bash
npm run db:push
npm run db:generate
```

### 8. Run Locally

```bash
npm run dev
# Open http://localhost:3000
```

### 9. Deploy to Vercel

```bash
npm i -g vercel
vercel
# Add all env vars in Vercel dashboard
```

---

## Pricing Tiers

| Plan | Price | Clients | QBRs |
|------|-------|---------|------|
| Free | $0 | 2 | 5 total |
| Solo | $49/mo | 10 | Unlimited |
| Growth | $99/mo | 50 | Unlimited |
| Agency | $199/mo | Unlimited | Unlimited |

---

## Launch Checklist

- [ ] Deploy to Vercel
- [ ] Set up custom domain (e.g., qbrdeck.misecuretechsolutions.com)
- [ ] Enable all env vars in Vercel
- [ ] Test Stripe webhook in live mode
- [ ] Add to AppSumo for launch discount
- [ ] Post in r/msp, MSPGeek Slack, IT Nation
- [ ] Set up support email: support@qbrdeck.com

---

## Support

mcamara@misecuretechsolutions.com
