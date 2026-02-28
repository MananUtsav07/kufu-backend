import type { SupabaseClient } from '@supabase/supabase-js'
import { AppError } from '../lib/errors.js'

const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const phoneRegex = /(?:\+?\d[\d\s\-()]{7,}\d)/i
const demoIntentRegex = /\b(book|schedule|arrange).{0,20}\b(demo|call|meeting)\b|\bdemo\b/i

export type ClientKnowledgeRow = {
  client_id: string
  services_text: string | null
  pricing_text: string | null
  faqs_json: unknown[] | null
  hours_text: string | null
  contact_text: string | null
}

export type LeadCaptureInput = {
  clientId: string
  content: string
  sessionId: string
}

export function estimateTokens(content: string): number {
  if (!content) {
    return 0
  }

  return Math.max(1, Math.ceil(content.length / 4))
}

export async function loadClientKnowledgeText(
  supabaseAdminClient: SupabaseClient,
  clientId: string,
  clientsKnowledgeText?: string | null,
): Promise<string> {
  const parts: string[] = []

  if (clientsKnowledgeText && clientsKnowledgeText.trim().length > 0) {
    parts.push(`Client Knowledge Base:\n${clientsKnowledgeText.trim()}`)
  }

  const { data, error } = await supabaseAdminClient
    .from('client_knowledge')
    .select('client_id, services_text, pricing_text, faqs_json, hours_text, contact_text')
    .eq('client_id', clientId)
    .maybeSingle<ClientKnowledgeRow>()

  if (error) {
    throw new AppError(`Failed to load client knowledge: ${error.message}`, 500)
  }

  if (!data) {
    return parts.join('\n\n').trim()
  }

  if (data.services_text) {
    parts.push(`Services:\n${data.services_text}`)
  }
  if (data.pricing_text) {
    parts.push(`Pricing:\n${data.pricing_text}`)
  }
  if (data.hours_text) {
    parts.push(`Hours:\n${data.hours_text}`)
  }
  if (data.contact_text) {
    parts.push(`Contact:\n${data.contact_text}`)
  }
  if (Array.isArray(data.faqs_json) && data.faqs_json.length > 0) {
    parts.push(`FAQs:\n${JSON.stringify(data.faqs_json, null, 2)}`)
  }

  return parts.join('\n\n').trim()
}

export async function storeChatMessages(args: {
  supabaseAdminClient: SupabaseClient
  userId: string
  chatbotId: string
  sessionId: string
  userMessage: string
  assistantMessage: string
}) {
  const rows = [
    {
      user_id: args.userId,
      chatbot_id: args.chatbotId,
      session_id: args.sessionId,
      role: 'user',
      content: args.userMessage,
      tokens_estimate: estimateTokens(args.userMessage),
    },
    {
      user_id: args.userId,
      chatbot_id: args.chatbotId,
      session_id: args.sessionId,
      role: 'assistant',
      content: args.assistantMessage,
      tokens_estimate: estimateTokens(args.assistantMessage),
    },
  ]

  const { error } = await args.supabaseAdminClient.from('chatbot_messages').insert(rows)

  if (error) {
    throw new AppError(`Failed to store chatbot messages: ${error.message}`, 500)
  }
}

function normalizePhone(value: string): string {
  return value.replace(/[^\d+]/g, '').trim()
}

export async function upsertLeadFromMessage(
  supabaseAdminClient: SupabaseClient,
  input: LeadCaptureInput,
): Promise<void> {
  const email = input.content.match(emailRegex)?.[0] ?? null
  const phoneRaw = input.content.match(phoneRegex)?.[0] ?? null
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null
  const hasDemoIntent = demoIntentRegex.test(input.content)

  if (!email && !phone && !hasDemoIntent) {
    return
  }

  let existingLeadId: string | null = null

  if (email) {
    const { data } = await supabaseAdminClient
      .from('leads')
      .select('id')
      .eq('client_id', input.clientId)
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>()

    if (data?.id) {
      existingLeadId = data.id
    }
  }

  if (!existingLeadId && phone) {
    const { data } = await supabaseAdminClient
      .from('leads')
      .select('id')
      .eq('client_id', input.clientId)
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>()

    if (data?.id) {
      existingLeadId = data.id
    }
  }

  if (existingLeadId) {
    const { error } = await supabaseAdminClient
      .from('leads')
      .update({
        email,
        phone,
        need: hasDemoIntent ? 'Requested demo in chat' : null,
        source: 'chat',
      })
      .eq('id', existingLeadId)

    if (error) {
      throw new AppError(`Failed to update lead from chat: ${error.message}`, 500)
    }

    return
  }

  const { error } = await supabaseAdminClient.from('leads').insert({
    client_id: input.clientId,
    email,
    phone,
    need: hasDemoIntent ? 'Requested demo in chat' : null,
    source: 'chat',
    status: 'new',
  })

  if (error) {
    throw new AppError(`Failed to insert lead from chat: ${error.message}`, 500)
  }
}
