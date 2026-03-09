import type { SupabaseClient } from '@supabase/supabase-js'

import type { createMailer } from '../lib/mailer.js'
import { loadChatbotById, loadClientById, loadClientByUserId, loadUserById } from './tenantService.js'

type Mailer = ReturnType<typeof createMailer>

async function resolveOwnerNotificationContext(args: {
  supabaseAdminClient: SupabaseClient
  chatbotId: string
}) {
  const chatbot = await loadChatbotById(args.supabaseAdminClient, args.chatbotId)
  if (!chatbot) {
    return null
  }

  const client = chatbot.client_id
    ? await loadClientById(args.supabaseAdminClient, chatbot.client_id)
    : await loadClientByUserId(args.supabaseAdminClient, chatbot.user_id)
  if (!client) {
    return null
  }

  const user = await loadUserById(args.supabaseAdminClient, client.user_id)
  if (!user) {
    return null
  }

  return {
    toEmail: user.email,
    chatbotName: chatbot.name,
    businessName: client.business_name,
  }
}

export async function notifyClientOnNewChat(args: {
  supabaseAdminClient: SupabaseClient
  mailer: Mailer
  chatbotId: string
  visitorId: string
  userMessage: string
}): Promise<void> {
  if (!args.mailer) {
    return
  }

  const notificationContext = await resolveOwnerNotificationContext({
    supabaseAdminClient: args.supabaseAdminClient,
    chatbotId: args.chatbotId,
  })

  if (!notificationContext?.toEmail) {
    return
  }

  await args.mailer.sendClientNewChatNotification({
    to: notificationContext.toEmail,
    submittedAtIso: new Date().toISOString(),
    chatbotName: notificationContext.chatbotName,
    businessName: notificationContext.businessName,
    visitorId: args.visitorId,
    firstMessage: args.userMessage,
  })
}

export async function notifyClientOnLeadCapture(args: {
  supabaseAdminClient: SupabaseClient
  mailer: Mailer
  chatbotId: string
  visitorId: string
  userMessage: string
  leadEmail?: string | null
  leadPhone?: string | null
  leadText?: string | null
}): Promise<void> {
  if (!args.mailer) {
    return
  }

  const notificationContext = await resolveOwnerNotificationContext({
    supabaseAdminClient: args.supabaseAdminClient,
    chatbotId: args.chatbotId,
  })

  if (!notificationContext?.toEmail) {
    return
  }

  await args.mailer.sendClientLeadCaptureNotification({
    to: notificationContext.toEmail,
    submittedAtIso: new Date().toISOString(),
    chatbotName: notificationContext.chatbotName,
    businessName: notificationContext.businessName,
    visitorId: args.visitorId,
    leadEmail: args.leadEmail ?? null,
    leadPhone: args.leadPhone ?? null,
    leadText: args.leadText ?? null,
    leadMessage: args.userMessage,
  })
}
