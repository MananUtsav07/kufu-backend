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
  websiteUrl?: string
  phone: string
  email: string
  message: string
}

type ContactLeadNotificationPayload = {
  to: string
  submittedAtIso: string
  firstName: string
  lastName: string
  email: string
  message: string
}

type PasswordResetEmailPayload = {
  to: string
  resetUrl: string
  expiresInMinutes: number
}

type ClientNewChatNotificationPayload = {
  to: string
  submittedAtIso: string
  chatbotName: string
  businessName: string
  visitorId: string
  firstMessage: string
}

type ClientLeadCaptureNotificationPayload = {
  to: string
  submittedAtIso: string
  chatbotName: string
  businessName: string
  visitorId: string
  leadName: string | null
  leadEmail: string | null
  leadPhone: string | null
  leadText: string | null
  leadMessage: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function toSafeCell(value: string | null | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    return '-'
  }

  return escapeHtml(normalized)
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
    async sendPasswordResetEmail(payload: PasswordResetEmailPayload): Promise<void> {
      const { to, resetUrl, expiresInMinutes } = payload

      const html = `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #0f172a;">
          <h2 style="margin-bottom: 12px;">Reset your Kufu password</h2>
          <p style="margin-bottom: 16px;">Click the button below to reset your password. This link expires in ${expiresInMinutes} minutes.</p>
          <p style="margin-bottom: 20px;">
            <a href="${resetUrl}" style="display: inline-block; padding: 10px 18px; background: #1325ec; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600;">
              Reset Password
            </a>
          </p>
          <p style="font-size: 13px; line-height: 1.5; color: #334155;">
            If the button does not work, use this link:<br />
            <a href="${resetUrl}">${resetUrl}</a>
          </p>
          <p style="font-size: 13px; color: #64748b;">If you did not request a password reset, you can safely ignore this email.</p>
        </div>
      `

      await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        {
          sender: { name: 'Kufu', email: emailFrom },
          to: [{ email: to }],
          subject: 'Reset your Kufu password',
          htmlContent: html,
          textContent: `Reset your Kufu password: ${resetUrl}\n\nLink expires in ${expiresInMinutes} minutes.\n\nIf you did not request this, ignore this email.`,
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
      const { to, submittedAtIso, fullName, businessType, websiteUrl, phone, email, message } = payload

      const html = `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #0f172a;">
          <h2 style="margin-bottom: 12px;">New Kufu Demo Request</h2>
          <p style="margin-bottom: 16px; color: #334155;">Submitted at: ${submittedAtIso}</p>
          <table style="border-collapse: collapse; width: 100%; font-size: 14px;">
            <tbody>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Full Name</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${fullName}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Business Type</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${businessType}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Website URL</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${websiteUrl || '-'}</td></tr>
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
            `Website URL: ${websiteUrl || '-'}`,
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
    async sendContactLeadNotification(payload: ContactLeadNotificationPayload): Promise<void> {
      const { to, submittedAtIso, firstName, lastName, email, message } = payload
      const fullName = `${firstName} ${lastName}`.trim()

      const html = `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #0f172a;">
          <h2 style="margin-bottom: 12px;">New Kufu Contact Message</h2>
          <p style="margin-bottom: 16px; color: #334155;">Submitted at: ${submittedAtIso}</p>
          <table style="border-collapse: collapse; width: 100%; font-size: 14px;">
            <tbody>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Name</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${fullName || '-'}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Email</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${email}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Message</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${message || '-'}</td></tr>
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
          subject: 'New Contact Message - Kufu',
          htmlContent: html,
          textContent: [
            'New Kufu Contact Message',
            `Submitted at: ${submittedAtIso}`,
            `Name: ${fullName || '-'}`,
            `Email: ${email}`,
            `Message: ${message || '-'}`,
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
    async sendClientNewChatNotification(payload: ClientNewChatNotificationPayload): Promise<void> {
      const { to, submittedAtIso, chatbotName, businessName, visitorId, firstMessage } = payload
      const safeSubmittedAt = toSafeCell(submittedAtIso)
      const safeBusinessName = toSafeCell(businessName)
      const safeChatbotName = toSafeCell(chatbotName)
      const safeVisitorId = toSafeCell(visitorId)
      const safeFirstMessage = toSafeCell(firstMessage)

      const html = `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #0f172a;">
          <h2 style="margin-bottom: 12px;">New Chat Started</h2>
          <p style="margin-bottom: 16px; color: #334155;">A new visitor started a chat with your bot.</p>
          <table style="border-collapse: collapse; width: 100%; font-size: 14px;">
            <tbody>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Submitted At</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${safeSubmittedAt}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Business</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${safeBusinessName}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Chatbot</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${safeChatbotName}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Visitor Session</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${safeVisitorId}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">First Message</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${safeFirstMessage}</td></tr>
            </tbody>
          </table>
        </div>
      `

      await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        {
          sender: { name: 'Kufu', email: emailFrom },
          to: [{ email: to }],
          subject: 'New Chat Started - Kufu',
          htmlContent: html,
          textContent: [
            'New Chat Started',
            `Submitted At: ${submittedAtIso}`,
            `Business: ${businessName}`,
            `Chatbot: ${chatbotName}`,
            `Visitor Session: ${visitorId}`,
            `First Message: ${firstMessage}`,
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
    async sendClientLeadCaptureNotification(payload: ClientLeadCaptureNotificationPayload): Promise<void> {
      const { to, submittedAtIso, chatbotName, businessName, visitorId, leadName, leadEmail, leadPhone, leadText, leadMessage } = payload
      const safeSubmittedAt = toSafeCell(submittedAtIso)
      const safeBusinessName = toSafeCell(businessName)
      const safeChatbotName = toSafeCell(chatbotName)
      const safeVisitorId = toSafeCell(visitorId)
      const safeLeadName = toSafeCell(leadName)
      const safeLeadEmail = toSafeCell(leadEmail)
      const safeLeadPhone = toSafeCell(leadPhone)
      const safeLeadText = toSafeCell(leadText)
      const safeLeadMessage = toSafeCell(leadMessage)

      const html = `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #0f172a;">
          <h2 style="margin-bottom: 12px;">Lead Captured From Chat</h2>
          <p style="margin-bottom: 16px; color: #334155;">A visitor message triggered lead capture in your chatbot.</p>
          <table style="border-collapse: collapse; width: 100%; font-size: 14px;">
            <tbody>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Submitted At</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${safeSubmittedAt}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Business</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${safeBusinessName}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Chatbot</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${safeChatbotName}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Visitor Session</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${safeVisitorId}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Lead Name</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${safeLeadName}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Lead Email</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${safeLeadEmail}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Lead Phone</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${safeLeadPhone}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Lead Text</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${safeLeadText}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Raw Message</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${safeLeadMessage}</td></tr>
            </tbody>
          </table>
        </div>
      `

      await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        {
          sender: { name: 'Kufu', email: emailFrom },
          to: [{ email: to }],
          subject: 'Lead Captured - Kufu',
          htmlContent: html,
          textContent: [
            'Lead Captured From Chat',
            `Submitted At: ${submittedAtIso}`,
            `Business: ${businessName}`,
            `Chatbot: ${chatbotName}`,
            `Visitor Session: ${visitorId}`,
            `Lead Name: ${leadName || '-'}`,
            `Lead Email: ${leadEmail || '-'}`,
            `Lead Phone: ${leadPhone || '-'}`,
            `Lead Text: ${leadText || '-'}`,
            `Raw Message: ${leadMessage}`,
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
