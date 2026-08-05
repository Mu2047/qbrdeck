import { Resend, type CreateEmailResponse } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

// Resend resolves with { data, error } on API-level failures (invalid key,
// unverified domain, bad recipient, rate limit) rather than throwing — only
// a network-level failure throws. Both must surface as a thrown error here
// so the caller's try/catch (app/api/qbrs/[qbrId]/send/route.ts) can turn
// either one into a non-2xx response instead of silently "succeeding".
const SEND_FAILURE_MESSAGE = 'Unable to send the email. Please try again.'

export async function sendQBREmail({
  to,
  clientName,
  quarter,
  year,
  mspName,
  portalUrl,
}: {
  to: string
  clientName: string
  quarter: string
  year: number
  mspName: string
  portalUrl: string
}) {
  let result: CreateEmailResponse
  try {
    result = await resend.emails.send({
    from: 'QBR Deck <noreply@misecuretechsolutions.com>',
    to,
    subject: `Your Q${quarter} ${year} Quarterly Business Review — ${clientName}`,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="margin:0;padding:0;background:#f4f5f7;font-family:Calibri,Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" style="padding:40px 20px;">
                <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
                  
                  <!-- Header -->
                  <tr>
                    <td style="background:#0a1634;padding:32px 40px;">
                      <p style="margin:0;color:#c9a02a;font-size:11px;letter-spacing:3px;text-transform:uppercase;">Quarterly Business Review</p>
                      <h1 style="margin:8px 0 0;color:#ffffff;font-size:24px;">${clientName}</h1>
                      <p style="margin:4px 0 0;color:#c9a02a;font-size:16px;">Q${quarter} ${year}</p>
                    </td>
                  </tr>

                  <!-- Gold bar -->
                  <tr><td style="background:#c9a02a;height:3px;"></td></tr>

                  <!-- Body -->
                  <tr>
                    <td style="padding:40px;">
                      <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
                        Dear ${clientName} team,
                      </p>
                      <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
                        Your Q${quarter} ${year} Quarterly Business Review is ready. Click the button below to view your full report online.
                      </p>

                      <!-- CTA Button -->
                      <table cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="background:#0a1634;border-radius:6px;">
                            <a href="${portalUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;">
                              View Your QBR Report →
                            </a>
                          </td>
                        </tr>
                      </table>

                      <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">
                        Or copy this link into your browser:<br/>
                        <a href="${portalUrl}" style="color:#0a1634;">${portalUrl}</a>
                      </p>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background:#f4f5f7;padding:24px 40px;border-top:1px solid #e5e7eb;">
                      <p style="margin:0;color:#9ca3af;font-size:12px;">
                        Prepared by ${mspName} · Confidential<br/>
                        Powered by QBR Deck
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
    })
  } catch {
    throw new Error(SEND_FAILURE_MESSAGE)
  }

  if (result.error) {
    throw new Error(SEND_FAILURE_MESSAGE)
  }
}