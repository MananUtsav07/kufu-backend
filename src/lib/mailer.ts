import { Resend } from 'resend'

type MailerOptions = {
  resendApiKey: string
  emailFrom: string
}

type VerificationEmailPayload = {
  to: string
  verificationUrl: string
  fallbackVerificationUrl: string
  expiresInMinutes: number
}

export function createMailer(options: MailerOptions) {
  const { resendApiKey, emailFrom } = options

  if (!resendApiKey) {
    return null
  }

  const resend = new Resend(resendApiKey)

  return {
    async sendVerificationEmail(payload: VerificationEmailPayload): Promise<void> {
      const { to, verificationUrl, fallbackVerificationUrl, expiresInMinutes } = payload

      const html = `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #0f172a;">
          <h2 style="margin-bottom: 12px;">Verify your Kufu account</h2>
          <p style="margin-bottom: 16px;">Click the button below to verify your email. This link expires in ${expiresInMinutes} minutes.</p>
          <p style="margin-bottom: 20px;">
            <a href="${verificationUrl}" style="display: inline-block; padding: 10px 18px; background: #1325ec; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600;">
              Verify Email
            </a>
          </p>
          <p style="font-size: 13px; line-height: 1.5; color: #334155;">
            If the button does not work, use this link:<br />
            <a href="${verificationUrl}">${verificationUrl}</a>
          </p>
          <p style="font-size: 13px; line-height: 1.5; color: #334155;">
            Backend direct verification link:<br />
            <a href="${fallbackVerificationUrl}">${fallbackVerificationUrl}</a>
          </p>
        </div>
      `

      await resend.emails.send({
        from: emailFrom,
        to,
        subject: 'Verify your Kufu account',
        text: `Verify your account: ${verificationUrl}\n\nBackup link: ${fallbackVerificationUrl}\n\nLink expires in ${expiresInMinutes} minutes.`,
        html,
      })
    },
  }
}