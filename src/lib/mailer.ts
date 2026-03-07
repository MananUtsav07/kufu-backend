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
  leadMessage: string
}

type PropertyTicketNotificationPayload = {
  to: string
  submittedAtIso: string
  ownerCompanyName: string
  tenantName: string
  tenantAccessId: string
  subject: string
  message: string
}

type PropertyEscalationNotificationPayload = {
  to: string
  submittedAtIso: string
  ownerCompanyName: string
  tenantName: string
  tenantAccessId: string
  intent: string
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

      const html = `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #0f172a;">
          <h2 style="margin-bottom: 12px;">New Chat Started</h2>
          <p style="margin-bottom: 16px; color: #334155;">A new visitor started a chat with your bot.</p>
          <table style="border-collapse: collapse; width: 100%; font-size: 14px;">
            <tbody>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Submitted At</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${submittedAtIso}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Business</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${businessName}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Chatbot</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${chatbotName}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Visitor Session</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${visitorId}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">First Message</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${firstMessage}</td></tr>
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
      const { to, submittedAtIso, chatbotName, businessName, visitorId, leadMessage } = payload

      const html = `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #0f172a;">
          <h2 style="margin-bottom: 12px;">Lead Captured From Chat</h2>
          <p style="margin-bottom: 16px; color: #334155;">A visitor message triggered lead capture in your chatbot.</p>
          <table style="border-collapse: collapse; width: 100%; font-size: 14px;">
            <tbody>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Submitted At</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${submittedAtIso}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Business</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${businessName}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Chatbot</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${chatbotName}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Visitor Session</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${visitorId}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Lead Message</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${leadMessage}</td></tr>
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
            `Lead Message: ${leadMessage}`,
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
    async sendPropertyTicketNotification(payload: PropertyTicketNotificationPayload): Promise<void> {
      const { to, submittedAtIso, ownerCompanyName, tenantName, tenantAccessId, subject, message } = payload

      const html = `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #0f172a;">
          <h2 style="margin-bottom: 12px;">New Tenant Support Ticket</h2>
          <p style="margin-bottom: 16px; color: #334155;">A tenant raised a support request in Property Management.</p>
          <table style="border-collapse: collapse; width: 100%; font-size: 14px;">
            <tbody>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Submitted At</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${submittedAtIso}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Owner</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${ownerCompanyName}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Tenant</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${tenantName} (${tenantAccessId})</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Subject</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${subject}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Message</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${message}</td></tr>
            </tbody>
          </table>
        </div>
      `

      await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        {
          sender: { name: 'Kufu', email: emailFrom },
          to: [{ email: to }],
          subject: 'New Tenant Ticket - Kufu Property Management',
          htmlContent: html,
          textContent: [
            'New Tenant Support Ticket',
            `Submitted At: ${submittedAtIso}`,
            `Owner: ${ownerCompanyName}`,
            `Tenant: ${tenantName} (${tenantAccessId})`,
            `Subject: ${subject}`,
            `Message: ${message}`,
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
    async sendPropertyEscalationNotification(payload: PropertyEscalationNotificationPayload): Promise<void> {
      const { to, submittedAtIso, ownerCompanyName, tenantName, tenantAccessId, intent, message } = payload

      const html = `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #0f172a;">
          <h2 style="margin-bottom: 12px;">Tenant Chat Escalation</h2>
          <p style="margin-bottom: 16px; color: #334155;">The AI assistant escalated a tenant conversation to owner support.</p>
          <table style="border-collapse: collapse; width: 100%; font-size: 14px;">
            <tbody>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Submitted At</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${submittedAtIso}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Owner</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${ownerCompanyName}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Tenant</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${tenantName} (${tenantAccessId})</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Intent</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${intent}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Message</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${message}</td></tr>
            </tbody>
          </table>
        </div>
      `

      await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        {
          sender: { name: 'Kufu', email: emailFrom },
          to: [{ email: to }],
          subject: 'Tenant Escalation - Kufu Property Management',
          htmlContent: html,
          textContent: [
            'Tenant Chat Escalation',
            `Submitted At: ${submittedAtIso}`,
            `Owner: ${ownerCompanyName}`,
            `Tenant: ${tenantName} (${tenantAccessId})`,
            `Intent: ${intent}`,
            `Message: ${message}`,
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
