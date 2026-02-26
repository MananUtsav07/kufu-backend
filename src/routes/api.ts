import { Router, type NextFunction, type Request, type Response } from 'express'
import type OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'

import { demoLeadSchema, contactLeadSchema, chatSchema, chatLogSchema } from '../schemas/api.js'
import { widgetConfigQuerySchema } from '../schemas/dashboard.js'
import { sanitizeMessages } from '../lib/sanitizeMessages.js'
import { buildSystemPrompt } from '../lib/systemPrompt.js'
import { getTimestamp, getClientIp, hashIp, respondValidationError } from '../lib/http.js'
import type { DataStore } from '../lib/dataStore.js'
import { createMailer } from '../lib/mailer.js'
import { createAuthRouter } from './auth.js'
import { createDashboardRouter } from './dashboard.js'

type ApiRouterOptions = {
  nodeEnv: string
  isProduction: boolean
  appBaseUrl: string
  openAiApiKey: string
  openAiModel: string
  openAiClient: OpenAI | null
  supabaseAdminClient: SupabaseClient | null
  jwtSecret: string
  emailUser: string
  emailPass: string
  dataStore: DataStore
}

type ClientKnowledgeRow = {
  client_id: string
  services_text: string | null
  pricing_text: string | null
  faqs_json: unknown[] | null
  hours_text: string | null
  contact_text: string | null
}

type LeadRow = {
  id: string
  client_id: string
  name: string | null
  email: string | null
  phone: string | null
  need: string | null
  status: string
  source: string | null
}

type LeadCapture = {
  clientId: string
  name: string | null
  email: string | null
  phone: string | null
  need: string | null
}

const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const phoneRegex = /(?:\+?\d[\d\s\-()]{7,}\d)/i
const nameRegex = /\b(?:my name is|i am|this is)\s+([a-z][a-z\s'.-]{1,40})\b/i
const demoIntentRegex = /\b(book|schedule|arrange).{0,20}\b(demo|call|meeting)\b|\bdemo\b/i

function parseUuidFromUnknown(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null
  }

  const trimmed = input.trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null
}

function extractChatClientId(request: Request, payload: { client_id?: string; metadata?: { client_id?: string } }): string | null {
  const queryClientId = parseUuidFromUnknown(request.query.client_id)
  const metadataClientId = parseUuidFromUnknown(payload.metadata?.client_id)
  const bodyClientId = parseUuidFromUnknown(payload.client_id)

  return bodyClientId ?? metadataClientId ?? queryClientId
}

function normalizePhone(value: string): string {
  return value.replace(/[^\d+]/g, '').trim()
}

function toNonEmptyOrNull(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function detectHeuristicLead(args: {
  clientId: string | null
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  explicitLead?: {
    name?: string
    email?: string
    phone?: string
    need?: string
    client_id?: string
  }
}): LeadCapture | null {
  const explicit = args.explicitLead
  const explicitClientId = parseUuidFromUnknown(explicit?.client_id)
  const resolvedClientId = explicitClientId ?? args.clientId
  if (!resolvedClientId) {
    return null
  }

  const userMessages = args.messages.filter((message) => message.role === 'user').map((message) => message.content)
  const searchText = userMessages.join('\n')
  const lastUserMessage = userMessages[userMessages.length - 1] ?? ''

  const email = toNonEmptyOrNull(explicit?.email) ?? toNonEmptyOrNull(searchText.match(emailRegex)?.[0] ?? null)
  const phoneCandidate = toNonEmptyOrNull(explicit?.phone) ?? toNonEmptyOrNull(searchText.match(phoneRegex)?.[0] ?? null)
  const phone = phoneCandidate ? normalizePhone(phoneCandidate) : null
  const name = toNonEmptyOrNull(explicit?.name) ?? toNonEmptyOrNull(searchText.match(nameRegex)?.[1] ?? null)
  const need =
    toNonEmptyOrNull(explicit?.need) ??
    (demoIntentRegex.test(lastUserMessage) ? 'User requested a demo via chat' : null)

  if (!email && !phone && !need) {
    return null
  }

  return {
    clientId: resolvedClientId,
    name,
    email,
    phone,
    need,
  }
}

async function getClientKnowledgeText(
  supabaseAdminClient: SupabaseClient | null,
  clientId: string | null,
): Promise<string> {
  if (!supabaseAdminClient || !clientId) {
    return ''
  }

  const { data, error } = await supabaseAdminClient
    .from('client_knowledge')
    .select('client_id, services_text, pricing_text, faqs_json, hours_text, contact_text')
    .eq('client_id', clientId)
    .maybeSingle<ClientKnowledgeRow>()

  if (error || !data) {
    if (error) {
      console.error('[chat] failed to load client knowledge:', error)
    }
    return ''
  }

  const parts: string[] = []
  if (data.services_text) parts.push(`Services:\n${data.services_text}`)
  if (data.pricing_text) parts.push(`Pricing:\n${data.pricing_text}`)
  if (Array.isArray(data.faqs_json) && data.faqs_json.length > 0) {
    parts.push(`FAQs JSON:\n${JSON.stringify(data.faqs_json, null, 2)}`)
  }
  if (data.hours_text) parts.push(`Hours:\n${data.hours_text}`)
  if (data.contact_text) parts.push(`Contact:\n${data.contact_text}`)

  return parts.join('\n\n').trim()
}

async function upsertLeadFromChat(
  supabaseAdminClient: SupabaseClient | null,
  lead: LeadCapture,
): Promise<void> {
  if (!supabaseAdminClient) {
    return
  }

  let existingLead: LeadRow | null = null

  if (lead.email) {
    const { data, error } = await supabaseAdminClient
      .from('leads')
      .select('id, client_id, name, email, phone, need, status, source')
      .eq('client_id', lead.clientId)
      .eq('email', lead.email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<LeadRow>()

    if (!error) {
      existingLead = data ?? null
    }
  }

  if (!existingLead && lead.phone) {
    const { data, error } = await supabaseAdminClient
      .from('leads')
      .select('id, client_id, name, email, phone, need, status, source')
      .eq('client_id', lead.clientId)
      .eq('phone', lead.phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<LeadRow>()

    if (!error) {
      existingLead = data ?? null
    }
  }

  if (existingLead) {
    await supabaseAdminClient
      .from('leads')
      .update({
        name: lead.name ?? existingLead.name,
        email: lead.email ?? existingLead.email,
        phone: lead.phone ?? existingLead.phone,
        need: lead.need ?? existingLead.need,
        source: 'chat',
      })
      .eq('id', existingLead.id)
      .eq('client_id', lead.clientId)
    return
  }

  await supabaseAdminClient.from('leads').insert({
    client_id: lead.clientId,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    need: lead.need,
    source: 'chat',
    status: 'new',
  })
}

export function createApiRouter({
  nodeEnv,
  isProduction,
  appBaseUrl,
  openAiApiKey,
  openAiModel,
  openAiClient,
  supabaseAdminClient,
  jwtSecret,
  emailUser,
  emailPass,
  dataStore,
}: ApiRouterOptions): Router {
  const router = Router()
  const mailer = createMailer({ emailUser, emailPass })

  router.get('/health', (_req: Request, res: Response) => {
    return res.json({
      ok: true,
      env: nodeEnv,
      openaiKeyPresent: Boolean(openAiApiKey),
    })
  })

  router.use(
    '/auth',
    createAuthRouter({
      isProduction,
      appBaseUrl,
      jwtSecret,
      supabaseAdminClient,
      mailer,
    }),
  )

  router.use(
    '/dashboard',
    createDashboardRouter({
      jwtSecret,
      supabaseAdminClient,
    }),
  )

  router.get('/widget/config', async (request: Request, response: Response) => {
    if (!supabaseAdminClient) {
      return response.status(500).json({
        ok: false,
        error: 'Server config missing: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY',
      })
    }

    const parsedQuery = widgetConfigQuerySchema.safeParse({
      client_id: request.query.client_id,
    })
    if (!parsedQuery.success) {
      return respondValidationError(parsedQuery.error, response)
    }

    try {
      const { data, error } = await supabaseAdminClient
        .from('clients')
        .select('id, business_name, website_url, plan')
        .eq('id', parsedQuery.data.client_id)
        .maybeSingle<{ id: string; business_name: string; website_url: string | null; plan: string }>()

      if (error) {
        console.error('[widget/config] lookup error:', error)
        return response.status(500).json({ ok: false, error: 'Failed to load widget config' })
      }

      if (!data) {
        return response.status(404).json({ ok: false, error: 'Client not found' })
      }

      return response.json({
        ok: true,
        config: {
          client_id: data.id,
          business_name: data.business_name,
          website_url: data.website_url,
          plan: data.plan,
          greeting: `Hi, welcome to ${data.business_name}. How can we help?`,
          theme: 'dark',
        },
      })
    } catch (error) {
      console.error('[widget/config] unexpected error:', error)
      return response.status(500).json({ ok: false, error: 'Server error while loading widget config' })
    }
  })

  router.post('/leads/demo', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = demoLeadSchema.safeParse(req.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, res)
      }

      await dataStore.appendJsonLine('leads_demo.jsonl', { ts: getTimestamp(), ...parsed.data })
      return res.json({ ok: true })
    } catch (error) {
      return next(error)
    }
  })

  router.post('/leads/contact', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = contactLeadSchema.safeParse(req.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, res)
      }

      await dataStore.appendJsonLine('leads_contact.jsonl', { ts: getTimestamp(), ...parsed.data })
      return res.json({ ok: true })
    } catch (error) {
      return next(error)
    }
  })

  router.post('/chat', async (req: Request, res: Response) => {
    console.log('[/api/chat] body:', JSON.stringify(req.body).slice(0, 2000))

    try {
      const parsed = chatSchema.safeParse(req.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, res)
      }

      const messages = sanitizeMessages(parsed.data.messages, 12)
      if (messages.length === 0) {
        return res.status(400).json({ reply: 'No valid messages provided.' })
      }

      const clientId = extractChatClientId(req, parsed.data)

      if (!isProduction) {
        console.log('[/api/chat] sanitized roles:', messages.map((message) => message.role))
        console.log('[/api/chat] resolved client_id:', clientId)
      }

      if (!openAiApiKey || !openAiClient) {
        return res.json({
          reply: 'OPENAI_API_KEY missing in kufu-backend/.env',
        })
      }

      const baseKnowledge = await dataStore.getKnowledgeText()
      const clientKnowledge = await getClientKnowledgeText(supabaseAdminClient, clientId)
      const mergedKnowledge = clientKnowledge
        ? `${baseKnowledge}\n\nCLIENT KNOWLEDGE (client_id: ${clientId})\n${clientKnowledge}`
        : baseKnowledge

      const system = buildSystemPrompt(mergedKnowledge)
      const completion = await openAiClient.chat.completions.create({
        model: openAiModel,
        messages: [
          { role: 'system', content: system },
          ...messages.map((message) => ({
            role: message.role,
            content: String(message.content || ''),
          })),
        ],
        temperature: 0.4,
      })

      const reply =
        completion.choices?.[0]?.message?.content?.trim() || "Sorry - I couldn't generate a response."

      await dataStore.appendJsonLine('chats_ai.jsonl', {
        ts: getTimestamp(),
        ipHash: hashIp(getClientIp(req)),
        sessionId: parsed.data.sessionId ?? null,
        page: parsed.data.metadata?.page ?? null,
        clientId,
        messages: [...messages, { role: 'assistant' as const, content: reply }],
        model: openAiModel,
      })

      const leadCapture = detectHeuristicLead({
        clientId,
        messages,
        explicitLead: parsed.data.lead,
      })

      if (leadCapture) {
        try {
          await upsertLeadFromChat(supabaseAdminClient, leadCapture)
        } catch (leadError) {
          console.error('[chat] failed to capture lead:', leadError)
        }
      }

      return res.json({ reply })
    } catch (error) {
      const chatError = error as {
        message?: string
        status?: number
        response?: { status?: number; data?: unknown }
        error?: unknown
      }

      console.error('[/api/chat] ERROR:', error)
      console.error('[/api/chat] message:', chatError?.message)
      console.error('[/api/chat] status:', chatError?.status ?? chatError?.response?.status)
      console.error('[/api/chat] data:', chatError?.response?.data ?? chatError?.error)

      return res.status(500).json({
        reply: 'Server error',
        details: chatError?.message ?? String(error),
        status: chatError?.status ?? chatError?.response?.status ?? null,
      })
    }
  })

  router.post('/chat/log', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = chatLogSchema.safeParse(req.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, res)
      }

      await dataStore.appendJsonLine('chats.jsonl', { ts: getTimestamp(), ...parsed.data })
      return res.json({ ok: true })
    } catch (error) {
      return next(error)
    }
  })

  router.use((_req: Request, res: Response) => {
    return res.status(404).json({
      ok: false,
      error: 'API route not found',
    })
  })

  return router
}
