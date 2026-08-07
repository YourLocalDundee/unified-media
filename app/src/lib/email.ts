import nodemailer from 'nodemailer'

const APP_NAME = 'Unified Media'
const SMTP_FROM = process.env.SMTP_FROM ?? `${APP_NAME} <no-reply@unified.local>`

function createTransport() {
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return null
  const port = parseInt(process.env.SMTP_PORT ?? '587')
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  })
}

export interface EmailPayload {
  to: string
  subject: string
  html: string
  text: string
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const transport = createTransport()
  if (!transport) {
    // Dev fallback — verification code visible in Docker logs
    console.log('\n[email:DEV] =========================================')
    console.log(`[email:DEV] TO:      ${payload.to}`)
    console.log(`[email:DEV] SUBJECT: ${payload.subject}`)
    console.log(`[email:DEV] BODY:\n${payload.text}`)
    console.log('[email:DEV] =========================================\n')
    return true
  }
  try {
    await transport.sendMail({ from: SMTP_FROM, to: payload.to, subject: payload.subject, html: payload.html, text: payload.text })
    return true
  } catch (err) {
    console.error('[email] Failed to send:', err)
    return false
  }
}

export function buildVerificationEmail(code: string, username: string): EmailPayload {
  return {
    to: '',
    subject: `${APP_NAME} — your verification code`,
    text: `Hi ${username},\n\nYour verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't create an account, ignore this email.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a;">
        <h2 style="margin-bottom:4px;">${APP_NAME}</h2>
        <p>Hi <strong>${username}</strong>,</p>
        <p>Your verification code is:</p>
        <div style="font-size:40px;font-weight:700;letter-spacing:10px;padding:20px;background:#f3f4f6;border-radius:10px;text-align:center;margin:20px 0;color:#111;">
          ${code}
        </div>
        <p style="color:#555;">This code expires in <strong>10 minutes</strong>. If you didn't create an account on ${APP_NAME}, you can safely ignore this email.</p>
      </div>
    `,
  }
}
