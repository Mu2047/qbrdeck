QBR Deck — Session B Root-Cause Investigation and Controlled Fix Plan



We completed a fresh-user production walkthrough from signup through client creation, QBR generation, export, portal sharing, email delivery, dashboard, and Analytics.



Do not begin broad onboarding changes yet. First investigate and fix the confirmed rendering defects using the existing RVTH Q3 2026 QBR as the reproduction record.



Confirmed working surfaces



The following are already functioning and must not be broken:



Fresh production signup and Clerk verification

New workspace creation

Free plan assignment

Client creation

QBR generation

Health-score calculation

QBR persistence and history

PDF export

PowerPoint export

Public portal content

Send-to-client email

Dashboard counters

Analytics counters

Export-package counting



The RVTH Q3 2026 QBR correctly produced:



Client: RVTH

Quarter: Q3 2026

Health score: 92/100

Health status: Excellent

Tickets closed: 86

Average resolution time: 3.8 hours

Uptime: 99.4%

Patch compliance: 96%

Security incidents: 1

Users supported: 40



PDF and PowerPoint both contain the complete nine-section QBR, including the roadmap and recommendations.



Do not change the Anthropic prompt, health-score formula, PDF generator, PowerPoint generator, database schema, billing logic, Clerk, Stripe, Resend, domains, or environment variables unless your investigation proves that a change is necessary.



Priority order

P0-1 Authenticated QBR renderer defects

P0-2 Public portal health-status mismatch

P1-1 Schedule/date/reminder defects

P1-2 Rename-notice condition

P1-3 Async action and autosave feedback

P2    Eight-screen onboarding improvements



Complete the P0 investigation and report before editing anything.



P0-1 — Authenticated QBR renderer defects



The authenticated QBR page at:



/dashboard/clients/\[clientId]/qbr/\[qbrId]



displays unresolved tokens:



{{healthScore}}/100 ({{healthStatus}})



It also fails to render the complete slide-specific data:



Cover omits the client and health-score presentation

Strategic Roadmap shows only its introduction

Strategic Recommendations shows only its introduction



The same QBR renders correctly in:



PDF

PowerPoint

Public portal



Investigation required



Trace the same QBR through these four paths:



Authenticated browser renderer

Public portal renderer

PDF renderer

PowerPoint renderer



Identify:



The component used by the immediate post-generation preview.

The component used by the saved authenticated QBR page.

Whether those two screens use the same renderer.

The exact object passed into the authenticated renderer.

The exact normalized object passed into PDF, PowerPoint, and portal.

Where placeholder substitution occurs.

Whether the authenticated renderer receives raw AI slide data instead of the resolved snapshot.

The property names and shapes used for:

clientName

quarter

year

healthScore

healthStatus

roadmap categories and items

strategic recommendations



Whether the authenticated renderer handles only generic fields such as:



title

content

bullets



while ignoring slide-specific arrays and objects.



Whether a shared normalized renderer already exists and can be reused.



Required outcome



The authenticated page must consume the same normalized, resolved QBR snapshot used by the working output surfaces.



Do not create a second competing slide schema.



The authenticated browser page must render:



RVTH

Q3 2026

92/100

Excellent



It must also render:



Critical roadmap column with 2 items

Important roadmap column with 2 items

Strategic roadmap column with 2 items

All 3 strategic recommendations

Why it matters

Risk if ignored

Expected benefit



Add a defensive unresolved-token check:



const unresolvedTokenPattern = /\\{\\{\[^}]+\\}\\}/



Never display raw unresolved tokens to a user. If an unresolved token remains after normalization, show a controlled internal rendering error and log the affected QBR ID.



Do not expose private client content unnecessarily in logs.



P0-2 — Public portal health-status mismatch



The public portal correctly shows this in the Executive Summary:



92/100 (Excellent)



But the Technology Health Score metric card shows:



92/100

Monitor



with Monitor styling.



The correct card result is:



Technology Health Score

92/100

Excellent



Investigation required



Identify:



Which field supplies the metric card's status.

Whether the card uses a generic metric-threshold function.

Whether healthStatus is available but ignored.

Whether card styling is hard-coded or derived from the wrong property.

Whether the authenticated preview and portal use separate metric-card components.



The health-score card must use the same deterministic healthStatus associated with the stored healthScore.



Do not recalculate the overall score independently inside the UI.



P1-1 — Schedule, date and reminder defects



The client page and dashboard produced conflicting or confusing schedule information:



Completed QBR: Q3 2026

Client-page date input: 04/01/2026

Client-page displayed due date: Mar 31, 2026

Dashboard reminder: Overdue · Apr 1

Last QBR label: 3 2026



A newly completed Q3 2026 QBR should not immediately produce an unexplained overdue reminder for April 2026.



Investigation required



Report:



The Prisma type of the schedule field.

The exact stored database value.

The API request and response format.

How the client page parses and formats the date.

How the dashboard parses and formats the date.

Whether a date-only value is being converted through UTC.

Why one screen shows March 31 while another shows April 1.

Why the quarter label omits the Q.

Whether generating a QBR currently changes nextQbrDue.

What rule currently determines:

overdue

due soon

on schedule

Whether the system permits a next-QBR date that predates the latest completed QBR period.



Do not implement automatic scheduling until you report the existing behavior and recommend a precise product rule.



The obvious display defect can be scoped separately:



3 2026 → Q3 2026



P1-2 — Rename-notice condition



The client page permanently shows:



If you updated the client name, re-export any existing QBRs

to apply the new name to PDF and PowerPoint.



The client was not renamed during this session.



Investigate where this notice is rendered and what condition controls it.



It should appear only after:



The client name changed successfully

AND

The client has at least one existing QBR



Prefer a temporary dismissible confirmation after an actual rename rather than a permanent banner.



P1-3 — Async action and autosave feedback



Inventory the current behavior for:



Send to Client

Share Link

PDF

PowerPoint

Inline QBR text editing/autosave

CSV import

QBR generation



For each action, report:



Loading state

Disabled-button behavior

Duplicate-action prevention

Success feedback

Error feedback

Screen-reader status announcement



Recommended states include:



Sending email…

QBR sent successfully



Creating share link…

Share link copied



Preparing PDF…

PDF downloaded



Preparing PowerPoint…

PowerPoint downloaded



Saving…

All changes saved



Couldn't save changes



Do not add fake percentage progress.



Dynamic success, waiting, and saving messages should be exposed through an appropriate status region such as role="status" where applicable.



Investigation report required before edits



Return a written report containing:



1\. Root cause of unresolved placeholders

2\. Root cause of missing roadmap/recommendation content

3\. Root cause of portal health-status mismatch

4\. Whether immediate preview and saved QBR use the same component

5\. Whether portal uses a different normalized renderer

6\. Schedule database type and stored value

7\. Source of the March 31 / April 1 difference

8\. Existing reminder calculation

9\. Existing rename-banner condition

10\. Existing async-action feedback behavior

11\. Exact files that need modification

12\. Minimal fix plan

13\. Tests that will be added

14\. Risks and rollback plan



Stop after delivering this report. Do not edit files until the report is reviewed and approved.



After approval — implementation rules



When approved:



Fix P0-1 and P0-2 first.

Use isolated commits.

Do not combine onboarding redesign with the P0 fixes.

Do not perform broad refactoring.

Preserve current PDF and PowerPoint output.

Preserve existing portal tokens and share links.

Preserve QBR usage counters.

Preserve inline-edit functionality.

Run npm run build.

Test the existing RVTH Q3 2026 record without regenerating it.



React supports rendering different JSX according to data type and explicitly rendering nested arrays with methods such as map(). Use those patterns only after confirming the actual slide structures and existing renderer architecture.



P0 acceptance tests



The existing RVTH Q3 2026 QBR must pass all of these:



Authenticated page shows RVTH

Authenticated page shows Q3 2026

Authenticated page shows 92/100 Excellent

No {{...}} token appears

Roadmap shows 3 categories and 6 total actions

All 3 recommendations appear

Portal score card says Excellent

Portal styling matches Excellent

PDF remains unchanged and correct

PowerPoint remains unchanged and correct

Public portal remains accessible

Existing email portal link remains accessible

No additional QBR usage is consumed

No additional export package is consumed during rendering tests

npm run build succeeds



Also test:



Refresh authenticated QBR page

Open authenticated QBR in a new tab

Open public portal in incognito

Navigate away and return from QBR History



Do not deploy until the before-and-after evidence and changed-file list are reported.



Deferred onboarding work



After the P0 and P1 fixes are completed and verified, return to the eight-screen onboarding specification.



Do not start these yet:



First-login checklist

Welcome wording

Client-form helper text

First-QBR progress indicator

Completion dashboard banner

Sample QBR

Landing-page changes

Pricing or plan changes

Database redesign



The current task is to make every existing QBR surface render the same valid stored report consistently.

---
---

# INVESTIGATION FINDINGS — RVTH Q3 2026 QBR

**Status: Read-only static code investigation. No files were edited except this one. No fixes have been implemented.**

Everything below was established by reading source files in this repository (paths, line numbers, and code quoted where relevant). Where a claim could not be verified from source alone (e.g., it depends on live AI output or database content not accessible in this read-only, in-repo investigation), it is explicitly labeled **ASSUMPTION** rather than presented as confirmed.

## 0. How the four rendering surfaces are wired together

There are four places a generated QBR's `slides` JSON gets turned into pixels, and they are **not** built the same way:

| Surface | File | Resolves placeholders? | Renders roadmap (`priorities`)? | Renders recommendations? |
|---|---|---|---|---|
| Post-generation preview | `app/(app)/dashboard/clients/[id]/qbr/new/page.tsx` (step `'preview'`, lines 199‑265) | **No** | **No** | **No** |
| Saved authenticated page | `app/(app)/dashboard/clients/[id]/qbr/[qbrId]/page.tsx` (lines 133‑275) | **No** | **No** | **No** |
| Public portal | `app/portal/[token]/page.tsx` (lines 23‑192) | **Yes** — `resolveSlides()` / `buildPlaceholderContext()` (lines 51‑70) | **Yes** (lines 146‑164) | **Yes** (lines 166‑180) |
| PDF export | `app/api/export-pdf/route.ts` (lines 85‑99) → `lib/export-pdf.tsx` | **Yes** — same `resolveSlides()` call | **Yes** (`export-pdf.tsx` lines 190‑205) | **Yes** (lines 207‑221) |
| PPTX export | `app/api/export-pptx/route.ts` (lines 85‑102) → `lib/export-pptx.ts` | **Yes** — same `resolveSlides()` call | **Yes** (`export-pptx.ts` lines 190‑213) | **Yes** (lines 216‑228) |

`lib/placeholders.ts` is explicitly documented (lines 1‑12) as "the ONLY place placeholders are resolved" and states PDF, PPTX, and "browser preview" must all use it — **but neither browser-based renderer (preview or saved page) actually imports or calls it.** `Grep` for `resolvePlaceholders|resolveSlides|buildPlaceholderContext` across the repo returns exactly 4 files: `lib/placeholders.ts` itself, `app/portal/[token]/page.tsx`, `app/api/export-pptx/route.ts`, `app/api/export-pdf/route.ts`. Confirmed by direct grep — zero hits in either QBR page component.

This single fact is the root cause of essentially all of P0-1.

---

## 1. P0-1 — Authenticated QBR renderer defects

### 1a. Root cause of unresolved `{{...}}` placeholders

**Confirmed.** The saved QBR page fetches the QBR record via `GET /api/qbrs/[qbrId]` (`app/api/qbrs/[qbrId]/route.ts` lines 7‑29) which does:

```ts
const qbr = await prisma.qBR.findFirst({ where: { id, workspaceId, deletedAt: null }, include: { client: true } })
return NextResponse.json(qbr)
```

This returns the **raw, stored `qbr.slides` JSON** with no placeholder resolution whatsoever. The client component then does `setSlides(data.slides ?? [])` (`[qbrId]/page.tsx` line 25) and renders `slide.content` / `slide.bullets` / metric `label`/`value` directly with no processing step. Any `{{healthScore}}`, `{{healthStatus}}`, `{{clientName}}`, etc. written into the AI-generated content by `lib/anthropic.ts` (the prompt explicitly instructs the model to write `{{healthScore}}`/`{{healthStatus}}` literally — see `lib/anthropic.ts` lines 84‑89) is displayed to the user verbatim.

The same is true of the **immediate post-generation preview**: `POST /api/generate-qbr` (`app/api/generate-qbr/route.ts` lines 209‑214) returns the freshly generated `slides` array straight from `generateQBRSlides()` with **no placeholder resolution** before sending it to the client (`res.json()` → `setSlides(data.slides)` in `new/page.tsx` line 163). So the preview shown immediately after generation should show the same literal `{{healthScore}}/100 ({{healthStatus}})` tokens as the saved page. The handoff document only explicitly reproduced this on the saved page, but the code path is identical for the preview — this is a **confirmed code-level finding**, not just an inference, since both components independently lack any call to `resolveSlides`/`resolvePlaceholders`.

**Recommended correction (do not implement yet):** Either (a) resolve placeholders server-side once at generation time and store the resolved text (breaks the "PDF/PPTX/portal always reflect current client name" guarantee described in `lib/placeholders.ts` — a live rename would then require regenerating, not just re-exporting), or (b) — preferred, consistent with the existing architecture comment in `lib/placeholders.ts` — have `GET /api/qbrs/[qbrId]` resolve placeholders before returning JSON (or have the client page call `resolveSlides` after fetch, mirroring the portal page's approach), and do the same for the `POST /api/generate-qbr` response used by the preview step. This reuses the single source of truth rather than creating a second one.

**Revision note:** option (b) above, taken naively, has a downstream data-integrity consequence for the saved QBR page specifically — its autosave path PATCHes the *entire* `slides` array on every single-field edit (see §12's "Data-integrity trace," added after this was identified), so if `GET /api/qbrs/[qbrId]` were changed to return only resolved slides and nothing else, the client would have no raw copy left to preserve, and any edit would permanently bake the resolved text into every untouched field too. The revised §12 plan keeps this section's recommendation (resolve for display) but has the GET route return the raw array **and** a separate resolved array side by side, so the saved page always retains an unmodified raw copy to PATCH from. Preview and the portal have no save-back path, so this risk does not apply to them — see §12.

### 1b. Root cause of missing roadmap / recommendations content

**Confirmed.** Both `new/page.tsx` (preview, lines 227‑261) and `[qbrId]/page.tsx` (saved page, lines 199‑272) render slide bodies with exactly this logic:

```tsx
<p>{slide.content}</p>
{slide.type === 'metrics' && slide.metrics && ( /* metric grid */ )}
{slide.bullets && ( /* bullet list */ )}
```

Neither component has any branch checking `slide.priorities` (the roadmap slide's critical/important/strategic arrays — see `QBRSlide` interface in `lib/anthropic.ts` lines 34‑38) or `slide.recommendations` (lines 39‑44). For the `roadmap` and `recommendations` slide types, `slide.bullets` is `undefined` (those slide types never populate `bullets` — see the AI prompt's JSON format spec, `lib/anthropic.ts` lines 123‑132), so only `slide.content` (the slide's one-paragraph intro) renders. This is exactly the reported symptom: "Strategic Roadmap shows only its introduction" / "Strategic Recommendations shows only its introduction."

By contrast, `app/portal/[token]/page.tsx` (lines 146‑180), `lib/export-pdf.tsx` (lines 190‑221), and `lib/export-pptx.ts` (lines 189‑228, via `addRoadmapSlide`/`addRecommendationsSlide`) all have explicit rendering for `slide.priorities` (3-column critical/important/strategic layout) and `slide.recommendations` (title/why/risk/benefit cards). The portal's JSX for these two blocks is the cleanest existing "normalized renderer" reference implementation — **a shared renderer already exists in spirit (the portal page), it is just not extracted into a reusable component and not reused by the two authenticated screens.**

**Recommended correction (do not implement yet):** Add `priorities` and `recommendations` render branches to both `new/page.tsx` and `[qbrId]/page.tsx`, following the same structure as `app/portal/[token]/page.tsx` lines 146‑180. Because the saved page also needs editing (see §1d), this is a good opportunity to extract a single shared read-only "slide body" renderer instead of maintaining three independent copies of the same JSX (currently: preview, saved page, portal each duplicate metric/bullet rendering; PDF/PPTX are structurally different because they use `@react-pdf/renderer` and `pptxgenjs` primitives, not JSX/HTML, so those two cannot share a component with the browser renderers).

### 1c. Whether the authenticated renderer handles only generic fields

**Confirmed.** Both `new/page.tsx` and `[qbrId]/page.tsx` handle only `title`, `content`, `bullets`, and `metrics` (for `slide.type === 'metrics'`). They have no awareness of `priorities` or `recommendations` at all — not even a fallback message. This matches the handoff's question precisely.

### 1d. Additional finding not explicitly called out in the handoff: inline editing cannot touch roadmap/recommendations even once rendering is fixed

The saved page's mutation functions are `updateContent`, `updateBullet`, `updateMetric` (`[qbrId]/page.tsx` lines 42‑68). There is no `updatePriorityItem` or `updateRecommendation`. Even after the rendering gap in §1b is closed, roadmap items and recommendation cards would be **read-only** on the saved page unless new mutation handlers are added — the "click any text to edit" hint (line 194‑196) would not apply to those two slide types. This should be scoped explicitly in the fix plan (either add edit handlers for parity, or intentionally leave roadmap/recommendations read-only and say so in the UI).

### 1e. Whether the authenticated renderer receives raw AI slide data instead of a resolved snapshot

**Confirmed, both preview and saved page.** See §1a — `data.slides` from `POST /api/generate-qbr` and `data.slides` from `GET /api/qbrs/[qbrId]` are both the raw, unresolved `QBRSlide[]` structure straight out of `lib/anthropic.ts` / the `qbr.slides` DB column, with no normalization step.

### 1f. Property names/shapes (confirmed from `lib/anthropic.ts` lines 23‑45)

```ts
interface QBRSlide {
  title: string
  type: 'cover' | 'executive_summary' | 'business_impact' | 'metrics' | 'wins' | 'risks' | 'roadmap' | 'recommendations'
  content: string
  bullets?: string[]
  metrics?: Array<{ label: string; value: string; status: 'good'|'caution'|'risk'; interpretation?: string }>
  priorities?: { critical: string[]; important: string[]; strategic: string[] }
  recommendations?: Array<{ title: string; why: string; risk: string; benefit: string }>
}
```

Note the `type` union includes `'cover'`, but the AI prompt (`lib/anthropic.ts` lines 91‑132) generates **exactly 7 slides**, none of type `'cover'`. All four renderers (preview, portal, PDF, PPTX) build the "cover" presentation as separate hardcoded markup, not as a slide in the array. `clientName`, `quarter`, `year`, `healthScore`, `healthStatus` are not top-level fields on `QBRSlide` at all — they only exist as `{{placeholder}}` tokens inside `content`/`bullets`/`recommendations[].why|risk|benefit`/`priorities[].*` strings, resolved externally via `lib/placeholders.ts` using data pulled from the `QBR`/`Client`/`Workspace` Prisma records (see `buildPlaceholderContext`, `lib/placeholders.ts` lines 162‑190). This is why "the exact object passed into the authenticated renderer" and "the exact normalized object passed into PDF/PPTX/portal" differ: the former is the raw DB/AI JSON, the latter is that same JSON post-`resolveSlides()`.

### 1g. Cover: client name and health score

**Confirmed — the saved QBR page (`[qbrId]/page.tsx`) has no cover section at all.** Its header is only:
```tsx
<h1 className="text-xl font-bold text-navy-800">Q{qbr.quarter} {qbr.year} QBR</h1>
```
(line 142) — the client's name is **never rendered anywhere on this page**, and neither is the health score/status outside of whatever literal text is embedded in slide content. This exactly matches "Cover omits the client and health-score presentation."

The **preview** page (`new/page.tsx` lines 220‑226) does render a styled navy cover block, but it also only shows `Q{form.quarter} {form.year}` — no client name, no health score card. So the preview's cover is incomplete in the same way, just with a different visual treatment (it at least looks like a cover slide).

By contrast: portal header shows `{qbr.client.name} — Q{qbr.quarter} {qbr.year}` (line 101) but still has no explicit health-score box in the header (score/status only reach the user via the resolved Executive Summary bullets and the Metrics slide). PDF (`export-pdf.tsx` `CoverPage`, lines 111‑137) and PPTX (`export-pptx.ts` lines 82‑103) both show client name **and** a dedicated health-score box on the cover — these are the most complete implementations and should be the reference for what the saved/preview covers should show.

**ASSUMPTION (not verifiable from source alone):** Because the AI prompt's `Client:` line is a literal placeholder token (`lib/anthropic.ts` line 69: `` Client: {{clientName}} ``, not string-interpolated with the real client name), the model is never told the real client name and is not explicitly instructed to write `{{clientName}}` back into its own bullet/content output (unlike the explicit "CRITICAL INSTRUCTION" given for `{{healthScore}}`/`{{healthStatus}}`, lines 84‑89). Whether the stored RVTH slide JSON actually contains literal `{{clientName}}` tokens in prose, the real name "RVTH" hallucinated in, or simply avoids naming the client, cannot be determined without reading the actual stored `qbr.slides` value for the RVTH record, which is outside this read-only source investigation. If unresolved `{{clientName}}` tokens are found in body text (not just the `{{healthScore}}`/`{{healthStatus}}` tokens already confirmed), the same fix in §1a would resolve them too, since `resolveSlides` handles all placeholders uniformly.

---

## 2. P0-2 — Public portal health-status mismatch

**Confirmed root cause.** `app/portal/[token]/page.tsx` renders every metric card (including the "Technology Health Score" card, which is metric #6 per the AI prompt spec, `lib/anthropic.ts` lines 100‑106) using a single generic 3-tier label function:

```tsx
const statusLabel = (s: string) =>
  s === 'good'    ? 'On track'       :
  s === 'caution' ? 'Monitor'        :
                    'Needs attention'
```
(portal page, lines 79‑82), applied uniformly at line 126 to every card in the metrics grid via `statusLabel(m.status)`.

`m.status` is a **3-value enum (`good`/`caution`/`risk`) the AI model itself assigns** per the prompt instruction (`lib/anthropic.ts` line 104: `"status": <"good" if healthStatus is Excellent or Strong, "caution" if Stable or Needs Attention, "risk" if High Risk>`). This is a free-form generation the model performs at write time — it is **not** deterministically derived from the stored `qbr.healthStatus` field (which uses the 5-tier `HealthStatus` union from `lib/health-score.ts`: `Excellent`/`Strong`/`Stable with Improvement Needed`/`Needs Attention`/`High Risk`, computed by `computeHealthScore()`/`scoreToStatus()`, lines 53‑59).

So for a 92/100 "Excellent" QBR, the portal's Executive Summary text is correct because it goes through `resolveSlides()` → `{{healthStatus}}` → literally "Excellent" (deterministic, sourced from the stored `qbr.healthStatus` column). But the metrics-grid health card's **label** is whatever 3-tier bucket the LLM happened to write into `m.status` for that specific field, translated through a hardcoded 3-way map that has no "Excellent" option at all — the best it can ever show is "On track." The handoff's observed "Monitor" (mapped from `status: "caution"`) indicates the model did not write `"good"` for this record despite a 92 score meeting the "Excellent" case in its own instructions — i.e., **the LLM's output for this one field is not reliably faithful to its own prompt**, and the architecture has no deterministic fallback/override to correct it.

**This is proven not to be a hypothetical risk, because the fix already exists twice, independently, in the two export renderers**, and the portal is the one surface missing it:

`lib/export-pdf.tsx` lines 162‑166:
```tsx
const isHealthScore = m.label?.toLowerCase().includes('health')
const scoreVal = isHealthScore ? parseInt(m.value) : NaN
const healthLabel = isHealthScore
  ? (scoreVal >= 90 ? 'Excellent' : scoreVal >= 80 ? 'Strong' : scoreVal >= 70 ? 'Stable with Improvement Needed' : scoreVal >= 60 ? 'Needs Attention' : 'High Risk')
  : c.label
```

`lib/export-pptx.ts` lines 175‑180 — functionally identical special-case, re-deriving the label from `m.value` (the score number) rather than trusting `m.status`.

Both PDF and PPTX special-case the health-score card by label-sniffing (`m.label.includes('health')`) and re-parsing the numeric score out of `m.value`, then applying **their own third, independent copy** of the score→status thresholds (duplicating `scoreToStatus()` in `lib/health-score.ts` lines 53‑59, rather than importing it — a separate code-duplication concern, functionally correct today but a latent drift risk if the threshold table changes and only `lib/health-score.ts` is updated). `app/portal/[token]/page.tsx` has no equivalent special case and no equivalent import.

**Answers to the handoff's specific questions:**
- Which field supplies the metric card's status → `m.status`, an AI-generated enum, not `qbr.healthStatus`.
- Generic metric-threshold function? → Yes, `statusLabel()`, applied to all metric cards uniformly, no special-casing for the health-score card.
- Is `healthStatus` available but ignored? → Yes. The portal page already loads `healthResult = resolveHealthScore(qbr)` (line 40) and uses `healthResult.status` for the placeholder context (line 59), so the correct 5-tier value is in scope on that very page — it is simply never consulted when rendering the metrics-grid card.
- Hard-coded styling or derived from the wrong property? → Derived from the wrong property (`m.status`, not `qbr.healthStatus`/`healthResult.status`).
- Separate metric-card components between authenticated preview and portal? → Yes — three independent, non-shared implementations exist (preview `new/page.tsx` lines 235‑248, saved page `[qbrId]/page.tsx` lines 219‑252, portal lines 120‑132), plus a fourth and fifth in `export-pdf.tsx`/`export-pptx.ts`. **The authenticated preview and saved page have the exact same bug as the portal** — neither special-cases the health-score card either, so once §1a's placeholder resolution is fixed for those two screens, they will independently reproduce this same "Excellent shown as Monitor" defect unless fixed together.

**Recommended correction (do not implement yet):** Do not recalculate the score in the UI (per the handoff's explicit constraint). Instead, replace the label-sniffing/re-parsing pattern with a lookup keyed on the actual `qbr.healthStatus`/`healthResult.status` value already available on every one of these pages, for the one metric card the generator marks as the health-score card — ideally by having the generator emit a stable identifier (e.g. a `metricKey: 'healthScore'` field) rather than relying on `label.includes('health')` string-matching, and by importing `scoreToStatus`/`statusToColor` from `lib/health-score.ts` everywhere instead of re-deriving the threshold table a third and fourth time.

---

## 3. P1-1 — Schedule, date, and reminder defects

### 3a. Prisma type and stored value

**Confirmed.** `prisma/schema.prisma` line 191: `nextQbrDate DateTime?` on `Client` — a full timestamp, not a date-only type (Postgres has no bare "date" type in use here). `QBR.quarter` is `String` (schema.prisma line 226), stored as a plain digit (`"1"`–`"4"`), never `"Q1"`–`"Q4"` — confirmed by `app/api/generate-qbr/route.ts` line 156 (`quarter: data.quarter`, straight from the form's `<select>` values `"1"`/`"2"`/`"3"`/`"4"` in `new/page.tsx` lines 284‑287) and the `schema` Zod validator (`generate-qbr/route.ts` line 13: `quarter: z.string()`, no prefix enforced).

### 3b. Root cause of the April 1 date and "unexplained overdue reminder"

**Confirmed, two compounding bugs.**

**Bug 1 — quarter-string format mismatch causes the wrong month to be picked.** `app/api/generate-qbr/route.ts` lines 182‑188:
```ts
const { suggestNextQbrDate } = await import('@/lib/reminder-utils')
if (!client.nextQbrDate) {
  await prisma.client.update({ where: { id: client.id }, data: { nextQbrDate: suggestNextQbrDate(data.quarter, data.year) } })
}
```
calls `suggestNextQbrDate(data.quarter, data.year)` where `data.quarter` is `"3"` (see §3a). But `lib/reminder-utils.ts` `suggestNextQbrDate` (lines 28‑38) expects a `"Q1"`–`"Q4"`-prefixed string:
```ts
export function suggestNextQbrDate(quarter: string, year: number): Date {
  const map: Record<string, { month: number; yearOffset: number }> = {
    Q1: { month: 3, yearOffset: 0 }, // April 1
    Q2: { month: 6, yearOffset: 0 }, // July 1
    Q3: { month: 9, yearOffset: 0 }, // October 1
    Q4: { month: 0, yearOffset: 1 }, // January 1 next year
  }
  const q = quarter.toUpperCase()          // "3".toUpperCase() === "3", not "Q3"
  const { month, yearOffset } = map[q] ?? { month: 3, yearOffset: 0 }   // lookup miss → falls back to the Q1 default (April, offset 0)
  return new Date(year + yearOffset, month, 1)
}
```
Because the caller never adds the `"Q"` prefix, `map["3"]` is always `undefined`, and the function silently falls back to the **`Q1` default of `{ month: 3, yearOffset: 0 }`** for every quarter except when `quarter` happens to already be `"Q1"`–`"Q4"`-formatted elsewhere (it never is, anywhere in this codebase — grep confirms `suggestNextQbrDate` has exactly one call site, this one). This part is a pure, deterministic function-behavior fact, confirmed by reading the function alone with no need for runtime evidence: **calling `suggestNextQbrDate("3", 2026)` (or any bare `"1"`–`"4"` digit string) always returns April 1, 2026, regardless of which quarter was actually intended** — for an intended **Q3** completion, the correct result should have been October 1, 2026 (the `Q3` map entry), so this call always returns a date 6 months earlier than intended whenever it fires for a Q3 QBR.

Whether this specific call actually fired for the RVTH record, and whether its output was in fact persisted as RVTH's `nextQbrDate`, depends on two conditions this investigation could not verify from source alone: (a) the guard `if (!client.nextQbrDate)` (`app/api/generate-qbr/route.ts` line 183) only runs this logic on a client's *first* QBR ever — whether RVTH's Q3 2026 QBR was RVTH's first QBR is a fact about that specific client's history, not something derivable from the code; (b) the actual value now sitting in the `Client.nextQbrDate` column for RVTH was never queried in this read-only, source-only investigation. **Framed precisely: the confirmed code path, if it ran for RVTH's first QBR, would write April 1, 2026 into `nextQbrDate` instead of the intended October 1, 2026 — this describes what the code does, not a confirmed read of RVTH's live database row.** See "Runtime verification still outstanding" below for what remains to be checked before treating this as a verified fact about the RVTH record specifically. This is a pure string-format bug, not a business-logic ambiguity: fixing the call site to pass `` `Q${data.quarter}` `` (or making `suggestNextQbrDate` accept bare digit strings) fixes it.

Also note: this only fires `if (!client.nextQbrDate)` — i.e. only on a client's *first* QBR ever. Generating a second, third, etc. QBR for an already-scheduled client does **not** currently update `nextQbrDate` at all (confirmed: no other write to `Client.nextQbrDate` exists outside this block and the manual date-picker in the client page). This directly answers the handoff's question "Whether generating a QBR currently changes nextQbrDate" — only conditionally, only once, and (per Bug 1) incorrectly.

**Bug 2 — timezone-dependent date rendering causes the Mar 31 vs Apr 1 split.** *(As with Bug 1, the following describes what the confirmed code path produces, not a verified read of RVTH's live database row — the actual stored value was not queried in this investigation.)* If Bug 1's April 1, 2026 value were written, it would be written as `new Date(2026, 3, 1)` — JavaScript's `Date(year, monthIndex, day)` constructor builds the date in **whatever timezone the executing runtime's local clock is set to.** This route runs server-side (Next.js API route), so the timestamp would be serialized as midnight in the server's local timezone (in a standard Vercel/Node deployment this is UTC — see "Runtime verification still outstanding" for why this is an assumption, not a confirmed deployment fact) — i.e. `2026-04-01T00:00:00.000Z`.

That single UTC instant, if it is indeed the stored value, would then be displayed in two different timezone contexts:
- **Client (browser) page** `app/(app)/dashboard/clients/[id]/page.tsx` — marked `'use client'` (line 1) — line 188: `` format(new Date(client.nextQbrDate), 'MMM d, yyyy') ``. `date-fns`'s `format()` uses the **browser's local timezone**. For any user in a negative UTC-offset timezone (e.g. US timezones), midnight UTC on April 1 falls on **March 31** local time — producing "Mar 31, 2026."
- **Dashboard page** `app/(app)/dashboard/page.tsx` — a **Server Component** (no `'use client'` directive, `async function DashboardPage`) — line 87: `` format(new Date(client.nextQbrDate), 'MMM d') ``. This executes on the server, in the server's local timezone (UTC in production), so the same instant would render as **"Apr 1."**

Same underlying timestamp, same `date-fns` call, two different timezones because one component is a Server Component and the other is a Client Component — this fully explains, as a *mechanism*, how a single stored instant could simultaneously render as "March 31" on one screen and "April 1" on another; it is a direct, code-confirmed consequence of where each component executes, independent of what RVTH's actual stored value turns out to be.

**Recommended correction (do not implement yet, and do not implement automatic scheduling logic beyond what's already there without a product decision — per the handoff's explicit instruction):** (1) Fix the `suggestNextQbrDate` call site to pass the `Q`-prefixed quarter (or normalize inside the function). (2) Decide and document a single rule for formatting date-only values consistently regardless of render context — e.g. format using UTC-based accessors (`date-fns`'s `formatInTimeZone` pinned to `'UTC'`, or storing/formatting via the UTC calendar date parts) rather than relying on implicit local-timezone conversion, since `nextQbrDate` is conceptually a calendar date, not a moment in time.

### 3c. Existing reminder-status calculation and its duplication

`lib/reminder-utils.ts` `getReminderStatus()` (lines 5‑26) is the single canonical implementation: `overdue` (diffDays < 0), `due-this-week` (diffDays ≤ 7), `due-this-month` (same calendar month/year as today), else `upcoming`. It is correctly imported and used by:
- `app/(app)/dashboard/page.tsx` line 21 (`getReminders()` helper)
- `app/api/reminders/route.ts` line 29

**However, `app/(app)/dashboard/clients/[id]/page.tsx` does not import or use `getReminderStatus` at all.** It reimplements the same concept inline (lines 193‑206) with **different thresholds**:
```tsx
!client.nextQbrDate ? 'Not Set' :
new Date(client.nextQbrDate) < new Date() ? 'Overdue' :
(diff) <= 7 * 86400000  ? 'Due This Week'  :
(diff) <= 30 * 86400000 ? 'Due This Month' :
'Upcoming'
```
This uses a flat 30-day window for "Due This Month," whereas `getReminderStatus` uses "same calendar month as today" — these two rules disagree near month boundaries (e.g. a date 10 days away that crosses into next calendar month is "Due This Month" on the client page but "upcoming" per the shared utility). This is a second, independent source of cross-screen inconsistency beyond the timezone issue in §3b, and should be consolidated onto the one shared `lib/reminder-utils.ts` implementation.

### 3d. Quarter label omitting "Q"

**Confirmed, two locations, same root cause** (§3a — `quarter` is stored as a bare digit string):
- `app/(app)/dashboard/clients/[id]/page.tsx` line 182: `` `${client.qbrs[0].quarter} ${client.qbrs[0].year}` `` → renders `"3 2026"`.
- `app/(app)/dashboard/page.tsx` line 81: `` `Last QBR: ${client.lastQbr.quarter} ${client.lastQbr.year}` `` → same defect, same page family.

Elsewhere in the codebase the convention is consistently `` `Q${qbr.quarter} ${qbr.year}` `` (e.g. `[qbrId]/page.tsx` line 142, `new/page.tsx` line 223, portal page line 101) — these two call sites simply omitted the `Q` prefix. Trivial, isolated fix: prepend `"Q"` at both locations.

### 3e. Whether the system permits a next-QBR date that predates the latest completed QBR period

**Confirmed possible, no guard exists.** The manual date-picker on the client page (`[id]/page.tsx` lines 208‑235) PATCHes `/api/clients/[id]` with any date the user picks, with no validation against `client.qbrs[0]` (the most recent QBR's quarter/year). `app/api/clients/[id]/route.ts` PATCH handler (lines 30‑70) does not compare `nextQbrDate` to any existing QBR. A user (or the buggy auto-suggest in §3b) can set `nextQbrDate` to a date earlier than the QBR just completed. This is a genuine gap the handoff explicitly asked about; per its instruction, **no fix should be implemented until a product rule is agreed** (e.g., "reject next-due dates earlier than 1 day after the latest QBR's period end" vs. simply relying on correcting the auto-suggest bug in §3b, which would prevent the *automatic* case but not manual entry).

---

## 4. P1-2 — Rename-notice condition

**Confirmed — the banner has no rename-detection condition of any kind.** `app/(app)/dashboard/clients/[id]/page.tsx` lines 163‑170:
```tsx
{/* Regenerate notice */}
{!editing && (
  <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 mb-6 flex items-center justify-between">
    <p className="text-sm text-blue-800">
      If you updated the client name, re-export any existing QBRs to apply the new name to PDF and PowerPoint.
    </p>
  </div>
)}
```
The **only** condition gating this block is `!editing` — i.e., it is visible any time the page is not in its inline-edit form state, which is the default/most-common state for any visit to the page. It does not check whether a rename occurred, when, or whether the client has any QBRs at all. It renders even for a client that was never renamed and has zero QBRs (with no QBRs, the advice to "re-export any existing QBRs" is nonsensical — `client.qbrs?.length === 0` is a real, reachable state per lines 244‑251).

Confirmed further: `PATCH /api/clients/[id]` (`app/api/clients/[id]/route.ts` lines 30‑70) has no concept of "did the name change" — it always writes `name` unconditionally (line 56) and returns the updated record with no `nameChanged` flag or previous-name diff. There is no server-side event, timestamp, or flag anywhere in the schema (`Client` model, schema.prisma lines 175‑204) recording a rename. Implementing the handoff's requested condition ("appears only after: the client name changed successfully AND the client has at least one existing QBR") requires **new client-side state at minimum** (compare submitted name to the previous value before the PATCH, e.g. inside `saveEdit()` in `[id]/page.tsx` lines 36‑55) since there is currently no rename-tracking of any kind to read.

**Recommended correction (do not implement yet):** Track "rename just happened" as transient client-side state set only inside `saveEdit()` when `form.name.trim() !== client.name` prior to the PATCH succeeding, gated additionally on `client.qbrs.length > 0`, rendered as a dismissible, auto-expiring confirmation (consistent with the pattern already used elsewhere on this page for `copied`/`sent` states in the sibling QBR page) rather than a permanent banner.

---

## 5. P1-3 — Async action and autosave feedback inventory

All examined in `app/(app)/dashboard/clients/[id]/qbr/[qbrId]/page.tsx` unless noted.

| Action | Loading state | Disabled during action | Success feedback | Error feedback | `role="status"`/`aria-live` |
|---|---|---|---|---|---|
| **Send to Client** (`sendToClient`, lines 71‑83) | `sending` → button text "Sending..." (implicit via `disabled` state, not shown in table text itself — see below) | Yes, `disabled={sending \|\| !sendEmail}` (line 185) | Always shown — "Sent!" for 3s (line 82), **regardless of response status** | **None.** `await fetch(...)` result is discarded entirely (line 74‑78) — no `res.ok` check, no error branch. A failed send (e.g. Resend API error surfaces as HTTP 500 from `app/api/qbrs/[qbrId]/send/route.ts` line 54) still shows "Sent!" to the user. | No |
| **Share Link** (`shareQBR`, lines 113‑123) | `sharing` → spinner icon (line 160) | Yes, `disabled={sharing}` (line 159) | Always shown — "Copied!" for 3s | **None.** `const data = await res.json()` (line 116) is used unconditionally — if the POST fails, `data.token` is `undefined`, producing a share URL literally containing `"undefined"` (`` `${origin}/portal/undefined` ``, line 117), which is still copied to the clipboard and reported as "Copied!" | No |
| **PDF export** (`exportFile('pdf')`, lines 85‑111) | `exporting === 'pdf'` → button text "Exporting..." (line 163) | Yes, `disabled={!!exporting}` (line 162, shared across both export buttons) | Implicit — file download triggers, no toast (browser's own download UI is the only signal) | **Handled correctly** — checks `!res.ok`, branches on `LIMIT_REACHED` (redirects to billing) vs. generic `alert(data.error ?? 'Export failed')` (lines 93‑101). This is a real (if crude — `alert()`, not a toast) error path, unlike Send/Share/Autosave. | No |
| **PowerPoint export** (`exportFile('pptx')`) | Same function as PDF, shares all behavior above | Yes | Same | Same (correctly handled) | No |
| **Inline text edit / autosave** (`EditableText` → `updateContent`/`updateBullet`/`updateMetric` → `saveSlides`, lines 29‑68, 278‑328) | `saveState === 'saving'` → "Saving..." spinner (line 147) | **No.** Nothing prevents further edits or navigation while a save is in flight; nothing prevents overlapping PATCH requests from rapid sequential edits (no debounce, no request cancellation/sequencing) | `saveState === 'saved'` → "Saved" check-mark for 2s (line 148, `saveTimer`) — **shown unconditionally after `await fetch(...)` resolves, with no `res.ok` check** (`saveSlides`, lines 29‑39) | **None — the required "Couldn't save changes" state does not exist anywhere in this component.** A failed PATCH (e.g. 403 Forbidden if role lacks `generateQBR`, or a 500) still flips to "Saved." | No |
| **CSV import** (`handleCSV`/`parseCSV`, `new/page.tsx` lines 29‑42, 102‑126) | N/A (synchronous, in-browser `FileReader`) | N/A | `csvStatus` block — "CSV imported successfully — N of 6 key metrics detected" with a green success card (lines 316‑332) | `csvError` — red error card with the caught message (lines 333‑338) — **this is the one action in the whole app with a fully correct, real success/error split.** | No |
| **QBR generation** (`generate()`, `new/page.tsx` lines 128‑169) | `loading` → animated spinner + "Generating QBR..." (lines 411‑418) | Yes, `disabled={loading \|\| qbrLimitReached}` (line 408) | Transitions to preview step on success — no separate toast, the preview itself is the confirmation | **Handled correctly** — checks `res.ok`, branches on `LIMIT_REACHED`, sets `error` state rendered in a red card (lines 150‑403) | No |

**Pattern identified:** every action that performs a `fetch()` **without inspecting the response status** (Send to Client, Share Link, autosave) unconditionally reports success — this is a single repeated code pattern (`await fetch(...)`, then proceed as if it succeeded), not three unrelated bugs. Every action that *does* check `res.ok` (PDF/PPTX export, CSV import, QBR generation) has a real, differentiated error path. None of the six action types use `role="status"`, `aria-live`, or any other screen-reader announcement mechanism anywhere in either file — all feedback is purely visual (icon + text color), confirmed by `grep`-level reading of both files with no `aria-` or `role=` attributes present.

**Recommended correction (do not implement yet):** Add `res.ok` checks (and a corresponding error UI state — "Couldn't send," "Couldn't create share link," "Couldn't save changes") to `sendToClient`, `shareQBR`, and `saveSlides`, mirroring the existing, already-correct pattern in `exportFile`. Wrap the dynamic status text (Sending…/Sent, Saving…/Saved/Couldn't save, Creating link…/Copied) in an element with `role="status"` so assistive tech announces state changes, per the handoff's explicit requirement. No fake progress percentages, consistent with the handoff's constraint.

---

## 6. Authentication, authorization, and ownership — cross-cutting review

**No defects found in this area during this investigation; documented here for completeness per the requested scope.**

- **Global gate:** `middleware.ts` — Clerk `clerkMiddleware`, explicitly exempts `/portal(.*)` (line 8) so the public portal never hits `auth().protect()`; requires auth for `/dashboard(.*)` with redirect to `/` when unauthenticated (lines 10‑15); requires auth for all `/api/*` **except** `/api/webhooks/*` (line 4, 17‑19). `authorizedParties` is pinned to the production domain (line 22).
- **Per-route defense in depth:** every authenticated API route reviewed (`app/api/qbrs/[qbrId]/route.ts`, `.../send/route.ts`, `.../share/route.ts`, `app/api/generate-qbr/route.ts`, `app/api/export-pdf/route.ts`, `app/api/export-pptx/route.ts`, `app/api/clients/route.ts`'s sibling `[id]/route.ts`, `app/api/reminders/route.ts`) independently re-checks `auth()` → `getWorkspaceMembership(clerkId)` → a `can.*` role check from `lib/permissions.ts`, rather than trusting the middleware alone.
- **Ownership/tenant isolation:** every Prisma query touching a `QBR` or `Client` scopes with `workspaceId: membership.workspaceId` (e.g. `qbrs/[qbrId]/route.ts` line 19, `export-pdf/route.ts` line 27, `clients/[id]/route.ts` line 19/46/84), and the schema enforces this at the DB level via composite foreign keys (`QBR.client` references `[id, workspaceId]` on `Client`, schema.prisma lines 216, 269; `ShareLink.qbr` similarly composite, lines 294). A membership in workspace A cannot address a QBR or client belonging to workspace B even by guessing IDs.
- **Role granularity:** `lib/permissions.ts` `can.*` map is consistently applied — e.g. `viewQBR` (VIEWER+) for `GET`, `generateQBR` (MEMBER+) for the slide-edit `PATCH`, `exportQBR` (MEMBER+) for PDF/PPTX/send/share, `editClient`/`deleteClient` (ADMIN+) for client mutation. This matches each route's actual sensitivity.
- **Public portal isolation:** `lib/share-links.ts` — tokens are 256-bit random (`randomBytes(32)`, line 21), only a SHA-256 hash is persisted (`tokenHash`, never the raw token — lines 22, 27), and `resolveSharedQbr()` checks `revokedAt`, `expiresAt`, and soft-delete flags on the QBR/client/workspace chain (lines 58‑62) before returning data. A legacy plaintext-token fallback path exists (lines 73‑83) for pre-migration links and is correctly scoped to `deletedAt: null` only (it predates the soft-delete-cascade check on client/workspace... actually it does check `legacy.client.deletedAt`/`legacy.client.workspace.deletedAt`, lines 80‑81, so it is consistent). No `workspaceId` is ever exposed in the portal URL or response (confirmed by reading the full portal page — only `client.name`, `quarter`, `year`, and resolved slide content are used).
- **Invite route:** `app/invite/[token]/page.tsx` was not deeply inspected, per the task's instruction to only do so if it affects the paths under investigation. One relevant observation from `middleware.ts` alone: `/invite/[token]` matches the general middleware matcher (not excluded like `/portal`) but is **not** included in `isProtectedPage` (only `/dashboard(.*)` is), so Clerk's `auth().protect()` is never invoked for it at the middleware layer — consistent with an invite-acceptance flow needing to be reachable by not-yet-authenticated or not-yet-onboarded users. This does not affect any of the QBR rendering, scheduling, or portal paths investigated above, so no further tracing was done here, per the task's scope-limiting instruction.

---

## 7. Prisma schema reference (fields actually used in the above findings)

From `prisma/schema.prisma`:
- `Client.nextQbrDate: DateTime?` (line 191) — full timestamp, drives §3.
- `QBR.quarter: String` (line 226) — bare digit, never `"Q"`-prefixed; drives §3d.
- `QBR.slides: Json?` (line 238) — raw `QBRSlide[]`; drives §1.
- `QBR.healthScore: Int?`, `QBR.healthStatus: String?`, `QBR.healthScoreVersion: String?`, `QBR.scoreBreakdown: Json?` (lines 247‑250) — deterministic score record, source of truth `resolveHealthScore()` in `lib/health-score.ts`; drives §2.
- `QBR.shareToken: String? @unique` (line 244) — explicitly marked **DEPRECATED** in a schema comment, superseded by `ShareLink`; still read as a fallback in `lib/share-links.ts`.
- `ShareLink.tokenHash`, `.revokedAt`, `.expiresAt` (lines 283, 288‑289) — drives §6's portal-security notes.
- `Subscription.qbrCount`/`.exportCount`/`.exportedQbrIds` — confirmed untouched by anything in this investigation; not read further, consistent with the handoff's "must not change billing logic" constraint.

---

## 8. Answers to the handoff's 14-point report checklist

1. **Root cause of unresolved placeholders** — §1a: neither the post-generation preview nor the saved QBR page ever calls `resolveSlides()`/`resolvePlaceholders()`; both display the raw AI-generated JSON verbatim, unlike portal/PDF/PPTX.
2. **Root cause of missing roadmap/recommendation content** — §1b: neither browser renderer has a JSX branch for `slide.priorities` or `slide.recommendations`; only `content`, `bullets`, and `type==='metrics' && metrics` are handled.
3. **Root cause of portal health-status mismatch** — §2: the metrics-grid card (including the health-score card) derives its label from the AI-authored 3-tier `m.status` field via a generic map, instead of from the deterministic `qbr.healthStatus`/`healthResult.status` already in scope on that page; PDF and PPTX both work around this with a duplicated, undeterministic-source-avoiding special case that the portal lacks.
4. **Whether immediate preview and saved QBR use the same component** — No shared component; two independently written, near-duplicate implementations (`new/page.tsx` preview step vs. `[qbrId]/page.tsx`) with the same gaps (§0, §1).
5. **Whether portal uses a different normalized renderer** — Yes: the portal (and PDF/PPTX) call `resolveSlides()`/`buildPlaceholderContext()`; the two authenticated screens do not. The portal's JSX is effectively the reference implementation for what a shared renderer should render.
6. **Schedule database type and stored value** — `Client.nextQbrDate DateTime?` (full timestamp). The confirmed code path (§3b Bug 1) would produce April 1, 2026 for a Q3 QBR whenever it fires — this is a property of the (buggy) function, verified by reading it, not a confirmed read of RVTH's actual database row, which was not queried in this investigation.
7. **Source of the March 31/April 1 difference** — §3b Bug 2: *if* the stored value is the one Bug 1 would produce, the mechanism that would split it into "Mar 31" vs "Apr 1" across two screens is confirmed: the same UTC timestamp formatted via `date-fns` `format()` in two different execution contexts — a Server Component (server-local/UTC time) vs. a Client Component (browser-local time). The mechanism is proven by source; whether it is in fact what produced the specific values reported in the handoff was not independently confirmed against the live database.
8. **Existing reminder calculation** — Canonical version in `lib/reminder-utils.ts getReminderStatus()`, correctly used by the dashboard and `/api/reminders`; independently and inconsistently reimplemented inline (different thresholds) in the client detail page (§3c).
9. **Existing rename-banner condition** — None; the banner's only condition is "not currently in the edit form," unconditional otherwise (§4).
10. **Existing async-action feedback behavior** — §5 table: Send to Client, Share Link, and autosave all ignore the fetch response status and always report success; only PDF/PPTX export and QBR generation have real error handling; no screen-reader announcements anywhere.
11. **Exact files that need modification** (for the eventual fix — not modified in this investigation):
    - `app/(app)/dashboard/clients/[id]/qbr/[qbrId]/page.tsx` (saved renderer — placeholders, roadmap/recommendations rendering, autosave error handling, send/share error handling, `role="status"`)
    - `app/(app)/dashboard/clients/[id]/qbr/new/page.tsx` (preview — same rendering gaps)
    - `app/api/qbrs/[qbrId]/route.ts` and/or the above two components (where placeholder resolution gets invoked)
    - `app/portal/[token]/page.tsx` (health-score card special-case, to fix §2, and as the reference for §1b)
    - `lib/export-pdf.tsx` / `lib/export-pptx.ts` (optional cleanup: replace duplicated threshold tables with imports from `lib/health-score.ts` — not required to fix the reported bugs, but flagged as drift risk)
    - `lib/reminder-utils.ts` (fix `suggestNextQbrDate` quarter-prefix handling) and `app/api/generate-qbr/route.ts` (its call site)
    - `app/(app)/dashboard/clients/[id]/page.tsx` (quarter-label "Q" prefix, rename-banner condition, reminder-status duplication, and its own `format()` timezone handling)
    - `app/(app)/dashboard/page.tsx` (quarter-label "Q" prefix, `format()` timezone handling)
12. **Minimal fix plan** — See "12. Minimal fix plan" below.
13. **Tests that will be added** — See "13. Tests that will be added" below.
14. **Risks and rollback plan** — See "14. Risks and rollback plan" below.

**These three sections describe a plan only — nothing in them has been implemented. Per the handoff and per explicit instruction, no code, configuration, schema, or data has been changed as part of authoring them.**

---

## Confirmed vs. assumption — summary

**Confirmed by direct source inspection (file + line evidence given above):** §1a, §1b, §1c, §1d, §1e, §1f, §2 (mechanism and existence of the bug; the specific "Monitor" output for a 92 score is consistent with, but not provable purely from, static source — it depends on what the LLM actually wrote for `m.status` on this record), §3a, §3c, §3d, §3e (existence of the gap), §4, §5, §6. §3b is confirmed as a **function-behavior fact** (what `suggestNextQbrDate`/`format()` deterministically do given known inputs) but **not** as a confirmed read of RVTH's live database row — see the reworded §3b and §8 item 6/7 above.

**Explicitly flagged as assumption, not confirmed:**
- §1g's claim about literal `{{clientName}}` tokens or hallucinated names appearing in AI-authored body text — requires inspecting the actual stored `qbr.slides` JSON for the RVTH record.
- §3b's "April 1, 2026" and the "Mar 31 vs Apr 1" split — confirmed as the output of a traced, deterministic code path, but **not** confirmed against RVTH's actual `Client.nextQbrDate` database value, which was not queried in this investigation. Presenting "April 1, 2026" as RVTH's confirmed stored value would overstate what static source review can prove; it is presented here strictly as "the value the confirmed code path produces."
- Whether RVTH's Q3 2026 QBR was in fact that client's *first* QBR (the precondition for Bug 1's `if (!client.nextQbrDate)` guard to have fired at all) — a fact about that specific client's history, not derivable from source.

See "Runtime verification still outstanding" below for the complete, consolidated list of everything in this report that depends on running the app or reading live data rather than reading source.

---

---

## 12. Minimal fix plan

**Nothing in this section has been implemented.** It is a plan for review, written to satisfy the handoff's report requirement. P0 and P1 are described as fully separate workstreams below, on the instruction to keep them separate; P0 is intended to ship first, in its own isolated commits (see §14), verified against the existing RVTH record before any P1 work begins.

### Data-integrity trace: what `saveSlides` actually PATCHes (traced before revising the plan below)

**Traced directly from `app/(app)/dashboard/clients/[id]/qbr/[qbrId]/page.tsx` lines 29‑68:**

```ts
async function saveSlides(updated: any[]) {
  setSaveState('saving')
  clearTimeout(saveTimer.current)
  await fetch(`/api/qbrs/${params.qbrId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slides: updated }),
  })
  setSaveState('saved')
  saveTimer.current = setTimeout(() => setSaveState('idle'), 2000)
}

function updateContent(slideIdx: number, value: string) {
  const updated = slides.map((s, i) => i === slideIdx ? { ...s, content: value } : s)
  setSlides(updated)
  saveSlides(updated)
}

function updateBullet(slideIdx: number, bulletIdx: number, value: string) {
  const updated = slides.map((s, i) => {
    if (i !== slideIdx) return s
    const bullets = s.bullets.map((b: string, j: number) => j === bulletIdx ? value : b)
    return { ...s, bullets }
  })
  setSlides(updated)
  saveSlides(updated)
}

function updateMetric(slideIdx: number, metricIdx: number, field: string, value: string) {
  const updated = slides.map((s, i) => {
    if (i !== slideIdx) return s
    const metrics = s.metrics.map((m: any, j: number) => j === metricIdx ? { ...m, [field]: value } : m)
    return { ...s, metrics }
  })
  setSlides(updated)
  saveSlides(updated)
}
```

`saveSlides` always PATCHes the **entire `slides` array** — `body: JSON.stringify({ slides: updated })`, where `updated` is the *whole* array (every slide), not a single-field delta. Every updater builds `updated` by mapping over the current `slides` **React state**: the target slide gets one field replaced; every other slide is passed through as `s` — a reference to whatever is currently sitting in `slides` state. `app/api/qbrs/[qbrId]/route.ts` `PATCH` (lines 31‑59) then writes that entire array verbatim: `data: { slides }` (line 53), with no per-field diffing or merge against the existing stored record.

**The risk this creates under the previously-proposed design:** the earlier version of this plan had `GET /api/qbrs/[qbrId]` return only the *resolved* slides, and had the saved page's `slides` state (and therefore every updater's `s`) hold that resolved array. Under that design, editing **any single field** — one bullet, one metric value — would call `saveSlides(updated)` with `updated` equal to the full array where 6 of RVTH's 7 slides are untouched but **already resolved** (their `{{healthScore}}`/`{{healthStatus}}`/`{{clientName}}` tokens already replaced with literal text by the GET route), and the 7th has one field changed. `PATCH` would then overwrite `qbr.slides` in the database with that fully-resolved array. **Every placeholder in every untouched field, across every slide, would be permanently baked into literal text on the very first edit of any kind — not just the field the user actually touched.** This would silently destroy the "PDF/PPTX/portal always reflect the current client name/branding at export time" property `lib/placeholders.ts` depends on for every subsequent export or portal view of that QBR, the moment anyone edited so much as one word. This is a data-integrity defect in the previously-proposed design, not a defect that exists in the app today (today's saved page already round-trips whatever it fetched, unresolved, so nothing is collapsed — the bug would have been newly introduced by resolving the GET response without also preserving a raw copy). The revised design below closes this gap.

### Shared building block for P0

**Prefer one shared browser slide renderer**, reused by the authenticated preview, the saved QBR page, and the public portal, as instructed. Proposed new file:

**`components/qbr/SlideBody.tsx` (new)** — a plain, presentational component (no `'use client'` pragma, so it is safe to render from the portal's Server Component as well as from the two Client Components). Extracted from the portal's existing, already-correct JSX (`app/portal/[token]/page.tsx` lines 108‑183), which becomes the reference implementation rather than something rewritten from scratch. It accepts an already-**resolved** `slide` (placeholders already substituted by the caller, before `SlideBody` ever sees it — `SlideBody` itself performs no resolution and holds no notion of "raw" data) and renders:
- `content` and `bullets` (existing logic, ported as-is)
- `type === 'metrics' && metrics`, including the health-score-card fix described below
- `priorities` (roadmap 3-column layout — new to preview/saved page, ported verbatim from the portal)
- `recommendations` (title/why/risk/benefit cards — new to preview/saved page, ported verbatim from the portal)

To keep the saved page's existing inline-editing working without forcing every consumer to become editable, `SlideBody` accepts an optional per-field text-rendering override (e.g. a `TextComponent` prop defaulting to a plain `<span>`/`<p>`) for the `content`/`bullets`/`metrics` fields only. The saved page passes its existing `EditableText` component through that prop; preview and portal simply omit it and get plain text. `priorities`/`recommendations` are rendered read-only unconditionally in this fix (see "Roadmap and recommendation editing," below) — no text-override hook is needed for those two branches yet. Because `SlideBody` only ever receives already-resolved data and never PATCHes anything itself, it has no role in — and cannot reintroduce — the data-integrity risk traced above; that risk lives entirely in how the saved page manages its own state around `SlideBody`, addressed in commit 4 below.

**Reusing the existing placeholder-normalization logic:** no new placeholder-resolution logic is written. Every consumer continues to call the existing `resolveSlides()` / `buildPlaceholderContext()` from `lib/placeholders.ts` (unchanged) before handing slides to `SlideBody` — the same call the portal and both export routes already make.

**Unresolved-token guard — client-safe display only, no logging in the shared component.** `SlideBody` includes a last-line-of-defense check (`unresolvedTokenPattern = /\{\{[^}]+\}\}/`, as specified in the original handoff's P0-1 section): if a string field it is about to render still matches this pattern, it renders a controlled internal error state for that slide instead of the literal token. **`SlideBody` itself must not call any logging, telemetry, or error-reporting function when this fires.** `SlideBody` is shared code that executes in two different trust contexts — inside the portal's Server Component (trusted, server-only) and inside the browser for the preview and saved pages (untrusted execution environment, visible to the end user and to any client-side error tracker such as Sentry that captures console output). A logging call placed inside `SlideBody` would, when it executes client-side, ship whatever it logs — potentially the QBR id, or worse, the offending content string itself if someone later "improved" the log line — into the browser's console and any connected client-side telemetry, which is exactly the private-content exposure the original handoff's P0-1 section warned against avoiding. Instead: the **server-side call sites that resolve placeholders** — `app/api/qbrs/[qbrId]/route.ts`'s `GET` handler, `app/api/generate-qbr/route.ts`, and `app/portal/[token]/page.tsx` (a Server Component, so this logging is inherently server-side there) — are the only places permitted to log a detection of unresolved tokens, and only after resolution has already run, only with the QBR id (never the offending string), using the server's normal logging mechanism (e.g. `console.error('[unresolved-placeholder]', qbr.id)`, matching the existing `console.error('[export-pdf]', ...)`/`console.error('[send-qbr]', ...)` pattern already used elsewhere in this codebase). `SlideBody`'s own guard is purely a rendering fallback — detect, hide, render a generic message — with zero side effects, so it behaves identically and safely regardless of which of the three surfaces renders it.

### P0 fix plan (P0-1 + P0-2 combined — one review, ships together, isolated from all P1 work)

**Commit order** (mirrors §14's isolated-commit list; see there for full rollback detail per step):

1. **Extract `SlideBody` from the portal with zero behavior change.** New file `components/qbr/SlideBody.tsx`, ported verbatim from `app/portal/[token]/page.tsx` lines 108‑183 — including that JSX's *existing* 3‑tier health-card label logic, unchanged. `app/portal/[token]/page.tsx` is edited to call `<SlideBody>` in place of its inline JSX; nothing else on that page changes (token resolution, branding, footer are untouched). This commit intentionally does **not** fix P0-2 yet — the health-card label bug is carried over into `SlideBody` as-is, so this step is a pure, low-risk extraction with no functional change to verify.
2. **Verify pixel-identical portal output** (a checkpoint, not a code change). Before proceeding, confirm the portal renders identically before and after commit 1 for the existing RVTH record — same text, same "Monitor" mislabel included (since it hasn't been fixed yet), same layout. This is the gate that proves the extraction was faithful before anything else is built on top of `SlideBody`.
3. **Add the deterministic health-card label *and* styling as a separate change (closes P0-2).** Two parts, one commit:
   - `lib/health-score.ts`: add `healthCardLabel(m, healthStatus)`, colocated with `scoreToStatus`/`statusToColor` (which it calls internally rather than re-deriving thresholds again). It identifies the health-score card the same way `export-pdf.tsx`/`export-pptx.ts` already do (`label.toLowerCase().includes('health')`) and, when matched, returns the deterministic `healthStatus` string verbatim instead of the AI-authored 3-tier label; every other metric keeps the existing `good`/`caution`/`risk` mapping.
   - `SlideBody.tsx`'s metrics-grid block is updated to call `healthCardLabel()` for the label **and** to derive that one card's background/border/text color from `statusToColor(healthStatus)` (already exported by `lib/health-score.ts`, currently unused anywhere in the app — confirmed by this investigation) instead of the generic `good`/`caution`/`risk` 3-color scheme every other card uses. `statusToColor()` returns a color family (`green`/`blue`/`yellow`/`orange`/`red`); this commit adds a small, new mapping from that family to the Tailwind classes `SlideBody` already uses for the other cards' bg/border/text, applied **only** to the metric identified as the health-score card. Both the text label and the card's visual styling are corrected together in this one commit — a label fix without the matching color fix would leave a card that says "Excellent" while still rendered in amber/red "caution/risk" styling, which is its own, only-partially-fixed defect.
   Because commit 1 already wired the portal to `SlideBody`, **this commit alone fixes P0-2 on the portal** (RVTH's card should show "Excellent" with green styling immediately after this lands, before any further commit). `lib/health-score.ts`'s existing exports (`computeHealthScore`, `scoreToStatus`, `statusToColor`, `resolveHealthScore`) are not modified — this is a pure addition plus one new call site inside `SlideBody`.
4. **Wire the saved authenticated page and immediate preview to the shared renderer.** This is the step that also closes P0-1 (unresolved tokens + missing roadmap/recommendations) and is where the data-integrity design below applies. Recommended sub-sequence for finer-grained review/rollback, all still under this one numbered step:
   - **4a. `app/api/qbrs/[qbrId]/route.ts` — `GET` handler (lines 7‑29).** After loading `qbr` + `client`, additionally load `workspace` (mirroring `app/api/export-pdf/route.ts` lines 64‑72) and call `resolveBranding()`, `resolveHealthScore()`, `buildPlaceholderContext()`, `resolveSlides()`. Return the JSON response with **two** slide arrays instead of one: `slides` stays exactly what it is today — the **raw**, unresolved `qbr.slides` value, unchanged, for backward compatibility with anything else that might read this field — plus a new `resolvedSlides` key holding the output of `resolveSlides()`, added purely for display. **The stored `qbr.slides` column in the database is never rewritten by this step** — resolution happens only at read time and only affects the new `resolvedSlides` field in the response.
   - **4b. `app/(app)/dashboard/clients/[id]/qbr/[qbrId]/page.tsx` (saved page) — raw/resolved state split.** This is the change that fixes the data-integrity risk traced above:
     - Replace the single `slides` state with two: `rawSlides` (initialized from the GET response's `data.slides` — the untouched, placeholder-bearing array; this is the array that gets PATCHed) and `resolvedSlides` (initialized from `data.resolvedSlides`; this is the array that gets rendered).
     - All display JSX — the existing `content`/`bullets`/`metrics` block and the new `<SlideBody>` call for `priorities`/`recommendations` — renders from `resolvedSlides`, never from `rawSlides`.
     - `updateContent`, `updateBullet`, and `updateMetric` are rewritten to build their `updated` array from **`rawSlides`**, not from the display state — structurally the same `slides.map((s, i) => i === slideIdx ? { ...s, ...} : s)` pattern as today, just applied to `rawSlides` so that every untouched slide passed through is the untouched, placeholder-bearing raw object, not a resolved one. The literal `value` the user typed (which is the *resolved* text they saw and edited) is written into that one field of the raw array — consistent with the already-existing, already-accepted behavior that an edited field's text is frozen from then on (see "Inline editing," below) — and the same literal value is mirrored into the corresponding field of `resolvedSlides` purely so the UI reflects the edit immediately, without waiting for a round trip.
     - `saveSlides(updatedRaw)` is called with the **raw-derived** array; its own body (`PATCH` with `{ slides: updatedRaw }`) is unchanged — the fix is entirely in what is passed to it, not in `saveSlides` itself. `app/api/qbrs/[qbrId]/route.ts`'s `PATCH` handler also needs **no change** — it already just persists whatever `slides` array it's given, which is exactly correct once the client only ever sends a raw-derived array.
     - **Net effect:** the PATCH payload for any single-field edit is now byte-identical to the previously-stored raw array except for the one field actually edited — every other slide, bullet, metric, and (untouched, still read-only) `priorities`/`recommendations` field retains its original `{{...}}` placeholders exactly as stored before the edit. See the new data-integrity test in §13.
   - **4c. `app/api/generate-qbr/route.ts` (lines 209‑214) and `app/(app)/dashboard/clients/[id]/qbr/new/page.tsx` (preview step).** The route already has `client`, `workspace`, `branding`, and `healthResult` in scope (lines 76‑110); add the same `resolveSlides()`/`buildPlaceholderContext()` call and return the resolved slides (plus `clientName`, so the preview's cover can show it without an extra round trip) in the JSON response. **The `qbr.create()` call a few lines earlier (lines 143‑179) is unchanged — the stored `slides` field remains the raw AI output**, identical to today. **The preview step has no save-back path at all** (confirmed by this investigation: `new/page.tsx` has no `updateContent`/`updateBullet`/equivalent, no `PATCH` call anywhere in that file — it is read-only apart from the Export buttons) — so it needs **no raw/resolved split**; it can consume the resolved slides directly via `<SlideBody>`, the same way the portal does, with no data-integrity risk to guard against. The preview's cover block (lines 220‑226) gains the client name + health-score box, matching PDF/PPTX.

**Explicitly not touched by the P0 fix, per the handoff's constraint** ("unless your investigation proves that a change is necessary" / this session's explicit instruction): the Anthropic prompt (`lib/anthropic.ts`), `prisma/schema.prisma`, `lib/export-pdf.tsx`/`lib/export-pptx.ts` core rendering logic (their existing, independent health-card special-case is left in place, not consolidated onto the new helper — that consolidation is optional cleanup, deferred, since their current output is already correct and the handoff says not to touch PDF/PPTX output unless strictly necessary), billing/limit code, Clerk, Stripe, Resend, domains, and environment variables. `app/api/qbrs/[qbrId]/route.ts`'s `PATCH` handler is also, per the trace above, correctly left unmodified.

**Inline editing after the P0 fix.** `EditableText` continues to work exactly as today — visually, nothing changes about how a user edits a field. What changes, per the raw/resolved split above, is *which array* the edit is applied to before saving: the user always sees and edits `resolvedSlides` text, but the edit is written into the corresponding field of `rawSlides` (freezing that one field's literal text, exactly as every editable field already behaves today) and **only that one field** — every other field's raw `{{...}}` placeholders are preserved untouched, which is the entire point of the revision in this section. This does not introduce a new class of behavior for the *edited* field (freezing on edit is already how the app works today for every editable field); it only closes the previously-proposed design's gap where *unedited* fields would also have been frozen as a side effect.

**Roadmap and recommendation editing — deliberately remain read-only in this fix.** `SlideBody` renders `priorities`/`recommendations` as plain text, with no `EditableText` wrapping and no new mutation handlers (`updatePriorityItem`/`updateRecommendation` are not added). Reasons: (a) the handoff's own P0 acceptance tests only require these two slide types to *render* correctly, not to become editable; (b) adding new mutation handlers, extending what `PATCH /api/qbrs/[qbrId]` accepts, and wiring new save paths is the kind of scope expansion the handoff explicitly warns against ("Do not perform broad refactoring," "Do not combine onboarding redesign with the P0 fixes"); (c) `SlideBody`'s optional `TextComponent` prop pattern means editability for these two slide types can be added later as a small, additive follow-up without touching the P0 rendering fix. Because these two fields are never targeted by any updater, they always pass through `rawSlides` unchanged on every PATCH, the same as any other untouched field under the raw/resolved design above.

### P1 fix plan (separate from P0 — separate PR/commit series, begins only after P0 is verified against RVTH per §13)

**P1-1 — schedule/date/reminder:**
- `lib/reminder-utils.ts`, `suggestNextQbrDate()` (lines 28‑38): normalize the incoming `quarter` argument (accept both `"3"` and `"Q3"`) rather than editing every call site, since a defensive fix at the one function is lower-risk than auditing all current and future callers.
- `app/(app)/dashboard/clients/[id]/page.tsx` line 182 and `app/(app)/dashboard/page.tsx` line 81: prepend `"Q"` to the quarter label.
- `app/(app)/dashboard/clients/[id]/page.tsx` lines 193‑206: delete the inline duplicate threshold logic; import and use `getReminderStatus()`/`formatReminderStatus()` from `lib/reminder-utils.ts` (the same functions already correctly used by the dashboard and `/api/reminders`).
- Date-formatting timezone consistency (`clients/[id]/page.tsx` line 188, `dashboard/page.tsx` line 87): **requires a product decision before implementation** (is "the due date" a UTC calendar date or the org's local calendar date?) — per the handoff's explicit instruction not to implement automatic scheduling changes without an agreed rule, this item is scoped but intentionally left unimplemented pending that decision.
- Guarding against a `nextQbrDate` that predates the latest completed QBR (§3e): explicitly **out of scope** for this fix pass, per the same handoff instruction.

**P1-2 — rename notice:** `app/(app)/dashboard/clients/[id]/page.tsx` — add local state (e.g. `justRenamed`), set it inside `saveEdit()` only when the submitted name differs from `client.name` **and** `client.qbrs?.length > 0`, immediately after a successful `PATCH`; auto-clear after a few seconds using the same `setTimeout` pattern already used for `copied`/`sent` states elsewhere in this file family; change the banner's condition from `{!editing && (...)}` to `{justRenamed && (...)}`.

**P1-3 — async/autosave feedback:** all confined to `app/(app)/dashboard/clients/[id]/qbr/[qbrId]/page.tsx`:
- `saveSlides()` (lines 29‑39): check `res.ok`; add an `'error'` value to the `SaveState` union; render "Couldn't save changes" instead of unconditionally reporting "Saved."
- `sendToClient()` (lines 71‑83): same pattern, new error state/message.
- `shareQBR()` (lines 113‑123): same pattern; do not populate `shareUrl` or copy to clipboard unless `res.ok` and `data.token` is present.
- Wrap the dynamic status text for save/send/share in an element with `role="status"` (`aria-live="polite"`).
- No change to `exportFile()` (already correct) or to `new/page.tsx`'s CSV import / generation flows (already correct).

---

## 13. Tests that will be added

**Nothing in this section has been run or written yet — this is the test plan referenced by §12, for review.**

### Unit tests
- `lib/reminder-utils.test.ts` (new): `suggestNextQbrDate('3', 2026)` and `suggestNextQbrDate('Q3', 2026)` both resolve to October 1, 2026 post-fix; an explicit regression case asserting the pre-fix behavior (April 1, 2026 for a bare digit) no longer occurs; `getReminderStatus()` boundary cases (0 days, 7 days, 8 days, same-calendar-month, next-calendar-month).
- `lib/health-score.ts` (extend/new test file): new `healthCardLabel()` helper — a 92-score card returns "Excellent" regardless of whether the fixture's `m.status` is `"good"`, `"caution"`, or `"risk"` (this is the direct regression test for the reported "92 shown as Monitor" defect); non-health-score metrics are unaffected and still use the existing `good/caution/risk` labels; existing exports (`computeHealthScore`, `scoreToStatus`, `statusToColor`, `resolveHealthScore`) are asserted unchanged (same inputs → same outputs as before the addition).
- `lib/placeholders.ts` (extend/new test file): `resolveSlides()` against a fixture containing `priorities`/`recommendations` correctly resolves placeholder strings nested inside those structures (already-implemented recursive behavior, lines 132‑155 — this test makes the P0 fix's reliance on it explicit and regression-proof).

### Component tests (`SlideBody` and the two page components)
- `SlideBody` renders `priorities` as three columns (Critical/Important/Strategic) with correct per-column and total item counts against an RVTH-shaped fixture (2 + 2 + 2 = 6 total roadmap actions).
- `SlideBody` renders all `recommendations` entries (3, for the RVTH fixture) with title, why, risk, and benefit text each.
- `SlideBody` never renders a string matching `/\{\{[^}]+\}\}/` given already-resolved fixture input; given a deliberately-unresolved fixture, it renders the controlled internal error state instead of the raw token (proves the defensive guard described in §12 without needing a live AI call).
- Saved QBR page, mocking `GET /api/qbrs/[qbrId]`: with a resolved-slides fixture matching RVTH, asserts "RVTH", "Q3 2026", "92/100", and "Excellent" all appear in the rendered output, and that no substring matching `{{` appears anywhere in the rendered DOM.
- Saved QBR page: health-score metric card shows "Excellent" even when the fixture's `m.status` is deliberately set to `"caution"` — the direct regression test for §2 on this specific surface.
- Rename banner: does not render on initial mount; renders only after `saveEdit()` resolves with a changed name **and** `client.qbrs.length > 0`; does not render for a renamed client with zero QBRs.
- Autosave: a mocked failing `PATCH` drives `saveState` to the new error value and renders "Couldn't save changes," not "Saved."
- Send to Client / Share Link: a mocked failing `POST` does not render "Sent!"/"Copied!"; renders an error state instead; the Share Link flow never produces or copies a URL containing the literal string `"undefined"`.

### API/route tests
- `GET /api/qbrs/[qbrId]`: response's new `resolvedSlides` field contains no `{{...}}` substrings for a fixture QBR with placeholder-bearing stored content; response's `slides` field (unchanged key) is asserted to still equal the **raw, unresolved** stored value — i.e., the fix adds a field, it does not change what `slides` means. Unauthenticated request still 401; cross-workspace request for a QBR belonging to a different workspace still 404 (regression guard confirming the added `workspace`/branding lookups did not loosen the existing `workspaceId` scoping).
- `POST /api/generate-qbr`: response `slides` are pre-resolved; a follow-up `prisma.qBR.findUnique` in the same test confirms the **persisted** `qbr.slides` row remains the raw, unresolved AI output — i.e., the fix changes only the API response, never what is written to the database.
- **`PATCH /api/qbrs/[qbrId]` — data-integrity test (new, critical — this is the direct regression test for the risk this revision addresses).** Seed a fixture QBR whose stored `qbr.slides` contains several distinct, still-unresolved `{{healthScore}}`/`{{healthStatus}}`/`{{clientName}}` tokens spread across multiple slides, bullets, and the metrics/priorities/recommendations blocks (mirroring realistic AI output shaped like RVTH's). Drive the saved QBR page (component-level, simulating a real user) to edit **exactly one bullet's text** in one slide. After the resulting `PATCH` resolves, read the record back directly via `prisma.qBR.findUnique` (bypassing any client cache) and assert: (a) the edited bullet's stored value now contains the user's literal edited text; (b) **every other field in the stored `slides` JSON — every other bullet, every metric, every `priorities` entry, every `recommendations` entry, and every `{{...}}` token inside any of them that the edit did not touch — is byte-identical to the pre-edit stored value.** This test must fail against the originally-proposed design (GET returning only resolved slides, saved page PATCHing that resolved array wholesale) and must pass against the raw/resolved-split design in this revision — it is the test that proves the fix.
- Existing routes not touched by this fix (`/api/export-pdf`, `/api/export-pptx`, `/api/qbrs/[qbrId]/share`, `/api/qbrs/[qbrId]/send`) — re-run any existing coverage unchanged, to confirm the P0 fix does not alter their behavior; if no such coverage currently exists (this investigation found no test files in the repo — see "Runtime verification still outstanding"), establishing at least minimal coverage for these routes should be discussed with the reviewer as part of the same effort.

### Build
- `npm run build` succeeds with zero new TypeScript errors after every P0 change (new `SlideBody` component, new `healthCardLabel` export, modified `GET`/`generate-qbr` routes, modified page components).

### Manual, production-safe verification — against the existing RVTH Q3 2026 record, without regenerating it
1. Load the saved QBR page for the existing RVTH Q3 2026 record. Confirm: "RVTH" visible, "Q3 2026" visible, "92/100" visible, "Excellent" visible (not "Monitor" or any other status word), and **no substring matching `{{` anywhere in the rendered page** (browser in-page search / view-source).
2. On the same page, confirm the roadmap slide shows 3 columns (Critical/Important/Strategic) totaling 6 combined action items, and the recommendations slide shows all 3 recommendation cards with why/risk/benefit text for each.
2a. **Data-integrity behavior is intentionally *not* manually verified against the live RVTH record.** The dedicated automated test above (API/route tests) is the authoritative verification for the raw/resolved split, because manually editing a bullet on RVTH to observe the effect would itself mutate the one reproduction record this whole investigation is built around — the same "existing generated assets must not be modified" constraint that applies to this investigation applies with extra force to a test whose entire purpose is to check what an edit does to stored data. If a manual/exploratory check of this behavior is wanted in addition to the automated test, it should be performed against a disposable client/QBR created specifically for that purpose (e.g. a throwaway "Test Co" client and QBR generated during verification and deleted afterward), never against RVTH.
3. **Refresh** (hard reload) the page — same result as steps 1‑2.
4. Open the same URL in a **new browser tab** — same result.
5. Open the QBR's **public portal** link in an **incognito/private window** — confirm client name, "Q3 2026," the health-score metric card shows "Excellent" (not "Monitor"), and roadmap/recommendations still render (these already worked pre-fix on the portal and must not regress from the `SlideBody` extraction).
6. From the client detail page, open **QBR History**, navigate away (e.g. to the Dashboard), then navigate back into the same QBR — confirm identical rendering to step 1 (no stale-cache/regression from the route or component changes).
7. **Download the existing PDF** for this record (do not regenerate the QBR). Confirm it is unchanged: all 9 sections present, correct client name, "92/100 Excellent," roadmap and recommendations content intact, exactly as already documented as working. Confirm no additional export credit is consumed if the record was already marked `EXPORTED` (compare `Subscription.exportCount` before/after; the `alreadyExported`/`isRedownload` logic in `app/api/export-pdf/route.ts` lines 50‑51/135 is untouched by this fix).
8. **Download the existing PowerPoint** for this record — same checks as step 7, via `app/api/export-pptx/route.ts`.
9. **Existing share link / emailed portal link** — confirm a pre-existing link for this QBR (from the original walkthrough, if one exists — see "Runtime verification still outstanding") still resolves after the fix, and now shows "Excellent" (not "Monitor") on the health card, since the portal renders through `SlideBody` post-fix while `lib/share-links.ts`'s token validation is untouched.
10. Confirm **QBR usage counters** (`Subscription.qbrCount`) and **export-package counters** (`Subscription.exportCount`, `exportedQbrIds`) are unchanged by merely viewing the authenticated page, portal, or refreshing (they should only change on `POST /api/generate-qbr` and `POST /api/export-pdf`/`export-pptx`, neither of which any of steps 1‑6 or 9 calls) — read the `Subscription` row before and after those steps and confirm no change.
11. Spot-check **Analytics** counters (out of scope for this fix, not touched by it) render the same numbers before and after the above steps.

---

## 14. Risks and rollback plan

**No fix has been implemented; this section describes anticipated risk and the rollback procedure that would apply once each commit lands.**

- **Data-integrity risk (autosave collapsing untouched placeholders) — the primary risk this revision addresses.** As traced in §12, a saved-page design that renders from a resolved array and PATCHes that same array wholesale would permanently overwrite every untouched field's raw `{{...}}` placeholders the first time a user edited anything. Mitigation: the raw/resolved state split in §12 commit 4b, where every updater builds its PATCH payload from `rawSlides` (never from the display state), so an edit's blast radius is exactly the one field touched. This is the one risk in this plan with a dedicated, purpose-built regression test (§13's `PATCH /api/qbrs/[qbrId]` data-integrity test) rather than being caught only incidentally by other coverage — treat that test as a merge gate for commit 4b, not optional coverage.
- **Rendering risk.** Extracting `SlideBody` from the portal's proven-correct JSX and reusing it for preview/saved page means a defect in `SlideBody` now has a three-surface blast radius instead of one. Mitigation: commit 1 is a pure extraction with an explicit pixel-identical verification gate (commit 2) before anything else is built on top of `SlideBody`, and the health-card fix (commit 3) is isolated from the extraction so a defect in one is never conflated with a defect in the other.
- **Autosave risk.** Adding a `res.ok` check to `saveSlides()` (P1-3 scope, not part of this P0 revision) changes user-visible behavior: previously always "Saved," now sometimes "Couldn't save." A miscalibrated check could turn previously-working saves into false failures. Mitigation: test directly against `PATCH /api/qbrs/[qbrId]`'s real response shape (line 56 — 200 with the updated `qbr` object) rather than assuming a shape. Kept separate from this revision's raw/resolved fix, which changes *what* `saveSlides` is called with, not `saveSlides` itself.
- **Tenant-isolation risk.** The `GET /api/qbrs/[qbrId]` change (§12 commit 4a) adds new Prisma reads (`workspace`) inside an already `workspaceId`-scoped handler. Mitigation: reuse the identical, already-proven-safe query pattern from `export-pdf`/`export-pptx` routes rather than writing a new query shape, and add the cross-workspace-404 regression test (§13, API tests) to the same PR.
- **Export-regression risk.** No P0 change touches `lib/export-pdf.tsx`, `lib/export-pptx.ts`, or their routes' generation logic (the optional consolidation onto `healthCardLabel` is explicitly deferred, not required — §12 commit 3). Residual risk is limited to an accidental import-graph side effect if `healthCardLabel`/the new `statusToColor` call site were added in a way that altered an existing `lib/health-score.ts` export's behavior — mitigated by adding both as pure additions and asserting the existing exports are unchanged (§13 unit tests) — plus the explicit manual re-download checks (§13 steps 7‑8) against the existing RVTH exports, since the handoff marks PDF/PPTX as "must not be broken."
- **Usage-counter / export-counter risk.** Neither the `GET /api/qbrs/[qbrId]` change nor the `POST /api/generate-qbr` response-shaping change touches `Subscription.qbrCount`/`exportCount`/`exportedQbrIds` — the risk is an implementation mistake (e.g. copy-pasting counter-increment logic from a neighboring route). Mitigation: keep the GET-route diff reviewably small (add resolution calls and the new response field only, do not restructure the handler), plus the explicit before/after counter check (§13 step 10).
- **Existing-share-link risk.** The portal refactor (§12 commit 1) touches only the JSX rendering already-resolved slides; it does not touch `lib/share-links.ts`, `resolveSharedQbr()`, token hashing, or `ShareLink`/legacy `shareToken` lookup logic. Residual risk is a visual regression in what an existing link displays, not the link's validity. Mitigation: manual check (§13 step 9) against a pre-existing share link rather than a freshly minted one, so the "old token still resolves after surrounding code changed" path is actually exercised.

### Isolated commits and per-commit rollback (P0 only — P1 commits follow the same pattern once scoped)

1. **Extract `SlideBody` from the portal, zero behavior change.** New `components/qbr/SlideBody.tsx`, ported verbatim (including the existing, still-buggy 3-tier health-card label) from `app/portal/[token]/page.tsx` lines 108‑183; portal page swapped to call `<SlideBody>`. Rollback: revert — portal returns to its own inline JSX, no other surface affected, since nothing else consumes `SlideBody` yet.
2. **Verify pixel-identical portal output** (checkpoint, not a code commit — see §13 step 5, which is re-run here specifically as the acceptance check for commit 1 before proceeding). No rollback applicable; if the check fails, commit 1 is fixed or reverted before commit 3 is started.
3. **Add the deterministic health-card label and styling as a separate change (closes P0-2).** `lib/health-score.ts` gains `healthCardLabel()`; `SlideBody.tsx`'s metrics block is updated to use it for both the label text and the card's color (via `statusToColor()`). Rollback: revert — `SlideBody` (and therefore the portal, already wired to it since commit 1) reverts to the AI-authored 3-tier label/coloring for the health card; no other commit depends on this one being present, since commit 4 consumes `SlideBody` as a whole and is unaffected by which label logic is inside it.
4. **Wire the saved authenticated page and immediate preview to the shared renderer,** in the sub-order given in §12 (4a `GET` route raw+resolved split → 4b saved-page raw/resolved state and updater rewrite → 4c `generate-qbr` response + preview). Rollback, per sub-step:
   - 4a alone: revert — saved page loses the new `resolvedSlides` field and reverts to raw-token display (today's pre-existing, already-broken behavior); no data loss, since 4a never writes to `qbr.slides`.
   - 4b alone (requires 4a to remain in place, since it depends on `resolvedSlides` existing in the GET response): revert — saved page reverts to the single-`slides`-state design; **if 4b is reverted while 4a is kept, the data-integrity risk this revision addresses would reopen**, so 4a and 4b must be reverted together if either is reverted, not independently. This is the one place in the P0 plan where two sub-steps are not independently revertable, and it should be called out explicitly in the PR description.
   - 4c alone: revert — preview reverts to showing raw tokens and missing roadmap/recommendations (today's pre-existing behavior); independent of 4a/4b and of the saved page entirely, since preview has no save-back path.

Landing order: 1 → 2 (gate) → 3 → 4a → 4b → 4c. Commits 1 and 3 are independently revertable from everything after them. Commit 4a is independently revertable on its own. **Commit 4b is not independently revertable from 4a** (see above) — treat 4a+4b as a single rollback unit if either needs to be undone. Commit 4c is independently revertable from all of 4a/4b.

**Record tested without regeneration:** all manual verification in §13 is performed against the **existing RVTH Q3 2026 QBR** (the record already generated during the original production walkthrough referenced at the top of this document). It is not regenerated at any point in the verification plan. The only intentional interactions with it are the two re-downloads called for by the handoff's own acceptance criteria (§13 steps 7‑8, PDF and PPTX), and those are explicitly checked against the "no additional export credit consumed" rule rather than assumed safe.

---

## Runtime verification still outstanding

The following could not be established by static source review and must be checked by actually running the app against the live RVTH Q3 2026 record (or reading its live database row) before treating the corresponding claims above as fully verified, not just code-path-confirmed:

1. **RVTH's actual `Client.nextQbrDate` value.** §3b traces a deterministic code path that would produce `2026-04-01T00:00:00.000Z` for a Q3 QBR under the stated conditions; the live database row was never queried.
2. **Whether Bug 1's guard condition (`if (!client.nextQbrDate)`) actually fired for RVTH** — i.e., whether RVTH's Q3 2026 QBR was that client's first QBR ever. This is a fact about RVTH's specific history, not derivable from the code.
3. **Whether the stored `qbr.slides` JSON for the RVTH record contains literal `{{clientName}}` tokens, a hallucinated name, or avoids naming the client** (§1g) — requires reading the actual stored JSON.
4. **Whether the AI actually wrote `m.status: "caution"` (or another non-`"good"` value) for the health-score metric on the RVTH record** — consistent with, but not provable from, the generic prompt/rendering code alone; the handoff's reported "Monitor" label implies this, but it was not independently re-derived from the stored record in this investigation.
5. **The production server's actual runtime timezone** — assumed UTC for a standard Vercel/Node deployment in §3b; not confirmed against the actual deployment configuration.
6. **Whether an automated test harness already exists in this repository.** No `__tests__` directory or `*.test.ts`/`*.spec.ts` files were found during this investigation's file enumeration, and no test-runner config (`vitest.config.ts`, `jest.config.js`, a `test` script in `package.json`) was specifically searched for beyond that. If no harness exists, establishing one is an additional, currently-unscoped prerequisite for §13's unit/component/API tests.
7. **Whether a pre-existing share link already exists for the RVTH QBR** (needed for §13 step 9 to test an *existing* link rather than a freshly minted one) — not determined in this investigation.
8. **A pre-fix reference copy of the actual RVTH PDF/PPTX exports**, to diff against post-fix re-downloads in §13 steps 7‑8 — not captured in this investigation; the verification steps are defined but not yet executed.

None of the above block delivering this report. They are the concrete, named gaps between "confirmed by reading source" and "confirmed by running the app," to be closed during implementation and verification — not before this report can be reviewed.

---

## Files inspected in this session

`QBR_INVESTIGATION.md` (existing handoff), `app/(app)/dashboard/clients/[id]/qbr/[qbrId]/page.tsx`, `app/(app)/dashboard/clients/[id]/qbr/new/page.tsx`, `app/(app)/dashboard/clients/[id]/page.tsx`, `app/(app)/dashboard/page.tsx`, `app/portal/[token]/page.tsx`, `app/api/qbrs/[qbrId]/route.ts`, `app/api/qbrs/[qbrId]/send/route.ts`, `app/api/qbrs/[qbrId]/share/route.ts`, `app/api/generate-qbr/route.ts`, `app/api/export-pdf/route.ts`, `app/api/export-pptx/route.ts`, `app/api/reminders/route.ts`, `app/api/clients/[id]/route.ts`, `middleware.ts`, `prisma/schema.prisma`, `lib/placeholders.ts`, `lib/health-score.ts`, `lib/anthropic.ts`, `lib/export-pdf.tsx`, `lib/export-pptx.ts`, `lib/reminder-utils.ts`, `lib/workspace.ts`, `lib/permissions.ts`, `lib/share-links.ts`, `lib/email.ts`. Directory structure of `app/`, `components/`, `lib/`, `prisma/` was enumerated via `Glob`; `components/` was confirmed empty (no `.ts`/`.tsx` files exist there — all UI lives directly in `app/**/page.tsx`).

**Second pass:** no additional source files were read beyond what is listed above — that update session completed the report's required 12/13/14 sections (minimal fix plan, tests, risks/rollback) by reasoning over the findings already documented in §0‑§8, added the "Runtime verification still outstanding" section, and corrected wording in §3b/§8/"Confirmed vs. assumption" that had presented April 1, 2026 as a confirmed RVTH database value rather than as the output of a confirmed code path. No fixes were implemented in that pass.

**Third pass (this update):** re-read `app/(app)/dashboard/clients/[id]/qbr/[qbrId]/page.tsx` lines 29‑68 to re-trace `saveSlides`/`updateContent`/`updateBullet`/`updateMetric` exactly (quoted verbatim in the new "Data-integrity trace" subsection of §12). No other source files were re-read; no new files were read for the first time. This pass revised §12 to close a data-integrity gap identified in the previously-proposed design (resolving the `GET /api/qbrs/[qbrId]` response without preserving a raw copy would have let any single-field edit permanently collapse every untouched placeholder in the record, since `saveSlides` PATCHes the whole `slides` array, not a per-field delta) by introducing a raw/resolved state split on the saved page; added a dedicated data-integrity regression test to §13 and a caveat keeping that test off the live RVTH record; added the corresponding risk and revised the isolated-commit list in §14 to the requested order (extract → verify → health-card label+styling → wire saved page/preview), including an explicit note that two of the sub-commits (4a/4b) are not independently revertable from each other. Also clarified that the health-card fix must correct styling as well as label text, and that the shared `SlideBody` component must never itself log unresolved-token detections (only the server-side call sites that already have `qbr.id` in scope may do so). No application code was modified in this pass.

**File modification confirmation:** the only file created or modified across all three investigation/revision sessions is `QBR_INVESTIGATION.md` (this file). No application code, configuration, environment files, database records, generated QBR records, routes, production data, or existing generated assets were modified. `git status` shows `QBR_INVESTIGATION.md` as the only changed/untracked file.

**Stop condition:** per the handoff's instruction and this session's explicit instruction, this is the investigation report — complete with all 14 required parts (§1‑§11 answered inline via §8, §12 revised minimal fix plan, §13 revised tests, §14 revised risks and rollback). No fixes have been implemented. Do not proceed to implementation until this report is reviewed and approved.

