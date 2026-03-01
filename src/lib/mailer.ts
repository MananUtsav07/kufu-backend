import axios from 'axios'

type MailerOptions = {
  brevoApiKey: string
  emailFrom: string
}

type VerificationEmailPayload = {
  to: string
  verificationUrl: string
  fallbackVerificationUrl: string
  expiresInMinutes: number
}

type DemoLeadNotificationPayload = {
  to: string
  submittedAtIso: string
  fullName: string
  businessType: string
  phone: string
  email: string
  message: string
}

export function createMailer(options: MailerOptions) {
  const { brevoApiKey, emailFrom } = options

  if (!brevoApiKey) {
    return null
  }

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

      await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        {
          sender: { name: 'Kufu', email: emailFrom },
          to: [{ email: to }],
          subject: 'Verify your Kufu account',
          htmlContent: html,
          textContent: `Verify your account: ${verificationUrl}\n\nBackup link: ${fallbackVerificationUrl}\n\nLink expires in ${expiresInMinutes} minutes.`,
        },
        {
          headers: {
            'api-key': brevoApiKey,
            'Content-Type': 'application/json',
          },
        },
      )
    },
    async sendDemoLeadNotification(payload: DemoLeadNotificationPayload): Promise<void> {
      const { to, submittedAtIso, fullName, businessType, phone, email, message } = payload

      const html = `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #0f172a;">
          <h2 style="margin-bottom: 12px;">New Kufu Demo Request</h2>
          <p style="margin-bottom: 16px; color: #334155;">Submitted at: ${submittedAtIso}</p>
          <table style="border-collapse: collapse; width: 100%; font-size: 14px;">
            <tbody>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Full Name</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${fullName}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Business Type</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${businessType}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Phone</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${phone}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Email</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${email}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Requirement</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${message || '-'}</td></tr>
            </tbody>
          </table>
        </div>
      `

      await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        {
          sender: { name: 'Kufu', email: emailFrom },
          to: [{ email: to }],
          replyTo: { email },
          subject: 'New Demo Request - Kufu',
          htmlContent: html,
          textContent: [
            'New Kufu Demo Request',
            `Submitted at: ${submittedAtIso}`,
            `Full Name: ${fullName}`,
            `Business Type: ${businessType}`,
            `Phone: ${phone}`,
            `Email: ${email}`,
            `Requirement: ${message || '-'}`,
          ].join('\n'),
        },
        {
          headers: {
            'api-key': brevoApiKey,
            'Content-Type': 'application/json',
          },
        },
      )
    },
  }
}
