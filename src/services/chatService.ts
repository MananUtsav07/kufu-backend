import type { SupabaseClient } from '@supabase/supabase-js'
import { AppError } from '../lib/errors.js'

const emailMatchRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const phoneMatchRegex = /(?:\+?\d[\d\s\-()]{7,}\d)/i
const emailReplaceRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const phoneReplaceRegex = /(?:\+?\d[\d\s\-()]{7,}\d)/g
const demoIntentRegex = /\b(book|schedule|arrange).{0,20}\b(demo|call|meeting)\b|\bdemo\b/i
const nameIntroRegex = /(?:(?:my name is|i(?:'m| am))\s+)([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)*)/i
const COMMON_WORDS = new Set(['hi', 'hey', 'hello', 'yes', 'no', 'ok', 'okay', 'sure', 'thanks', 'thank'])
export const LEAD_CAPTURE_ACKNOWLEDGEMENT = 'Thanks for sharing your details. Our team will contact you shortly.'

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
  name?: string | null
}

export type LeadCaptureResult = {
  captured: boolean
  name: string | null
  email: string | null
  phone: string | null
  leadText: string | null
  hasDemoIntent: boolean
}

type LeadRecord = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
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

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function extractLeadText(content: string): string | null {
  const stripped = content
    .replace(emailReplaceRegex, ' ')
    .replace(phoneReplaceRegex, ' ')
    .replace(/\b(email|mail|phone|number|whatsapp|contact|my|is|at)\b/gi, ' ')
    .replace(/[:;,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return stripped.length > 0 ? stripped : null
}

function extractName(content: string): string | null {
  const match = content.match(nameIntroRegex)
  if (match?.[1]) {
    const candidate = match[1].trim()
    if (candidate.length >= 2 && !COMMON_WORDS.has(candidate.toLowerCase())) {
      return candidate
    }
  }
  return null
}

function extractFirstEmail(content: string): string | null {
  const matches = content.match(emailMatchRegex)
  if (!matches || matches.length === 0) {
    return null
  }

  return normalizeEmail(matches[0])
}

function extractFirstPhone(content: string): string | null {
  const matches = content.match(phoneMatchRegex)
  if (!matches || matches.length === 0) {
    return null
  }

  return normalizePhone(matches[0])
}

export function appendLeadCaptureAcknowledgement(reply: string, leadCaptured: boolean): string {
  const normalizedReply = reply.trim()
  if (!leadCaptured || normalizedReply.length === 0) {
    return normalizedReply
  }

  if (normalizedReply.toLowerCase().includes(LEAD_CAPTURE_ACKNOWLEDGEMENT.toLowerCase())) {
    return normalizedReply
  }

  return `${normalizedReply}\n\n${LEAD_CAPTURE_ACKNOWLEDGEMENT}`
}

export async function upsertLeadFromMessage(
  supabaseAdminClient: SupabaseClient,
  input: LeadCaptureInput,
): Promise<LeadCaptureResult> {
  const email = extractFirstEmail(input.content)
  const phone = extractFirstPhone(input.content)
  const name = input.name ?? extractName(input.content)
  const hasDemoIntent = demoIntentRegex.test(input.content)
  const extractedLeadText = extractLeadText(input.content)
  const leadText = hasDemoIntent
    ? extractedLeadText
      ? `${extractedLeadText} (Requested demo)`
      : 'Requested demo in chat'
    : extractedLeadText

  if (!email && !phone) {
    return {
      captured: false,
      name: null,
      email: null,
      phone: null,
      leadText: null,
      hasDemoIntent,
    }
  }

  let existingLead: LeadRecord | null = null

  if (email) {
    const { data } = await supabaseAdminClient
      .from('leads')
      .select('id, name, email, phone')
      .eq('client_id', input.clientId)
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<LeadRecord>()

    if (data) {
      existingLead = data
    }
  }

  if (!existingLead && phone) {
    const { data } = await supabaseAdminClient
      .from('leads')
      .select('id, name, email, phone')
      .eq('client_id', input.clientId)
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<LeadRecord>()

    if (data) {
      existingLead = data
    }
  }

  if (existingLead) {
    const { error } = await supabaseAdminClient
      .from('leads')
      .update({
        name: name ?? existingLead.name ?? null,
        email: email ?? existingLead.email ?? null,
        phone: phone ?? existingLead.phone ?? null,
        need: leadText,
        source: 'chat',
      })
      .eq('id', existingLead.id)

    if (error) {
      throw new AppError(`Failed to update lead from chat: ${error.message}`, 500)
    }

    return {
      captured: true,
      name,
      email,
      phone,
      leadText,
      hasDemoIntent,
    }
  }

  const { error } = await supabaseAdminClient.from('leads').insert({
    client_id: input.clientId,
    name,
    email,
    phone,
    need: leadText,
    source: 'chat',
    status: 'new',
  })

  if (error) {
    throw new AppError(`Failed to insert lead from chat: ${error.message}`, 500)
  }

  return {
    captured: true,
    name,
    email,
    phone,
    leadText,
    hasDemoIntent,
  }
}
