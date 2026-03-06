import { Router, type Request } from 'express'
import type OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'

import { asyncHandler, AppError } from '../lib/errors.js'
import { getTimestamp } from '../lib/http.js'
import { buildSystemPrompt } from '../lib/systemPrompt.js'
import type { DataStore } from '../lib/dataStore.js'
import { retrieveRelevantChunks } from '../rag/retrieval.js'
import {
  estimateTokens,
  loadClientKnowledgeText,
  storeChatMessages,
  upsertLeadFromMessage,
} from '../services/chatService.js'
import { insertChatHistoryRow } from '../services/chatHistoryService.js'
import {
  enforcePlanMessageLimit,
  incrementSubscriptionUsage,
} from '../services/subscriptionService.js'
import {
  loadChatbotById,
  loadClientById,
  loadUserById,
} from '../services/tenantService.js'
import {
  loadWhatsAppIntegrationByPhoneNumberId,
  loadWhatsAppIntegrationByVerifyToken,
  normalizeWhatsAppAddress,
  sendWhatsAppTextMessage,
  updateWhatsAppIntegrationLastInboundAt,
  type WhatsAppIntegrationRow,
} from '../services/whatsappService.js'

type WhatsAppRouterOptions = {
  supabaseAdminClient: SupabaseClient
  openAiApiKey: string
  openAiModel: string
  openAiClient: OpenAI | null
  dataStore: DataStore
  whatsappGraphApiVersion: string
}

type IncomingWhatsAppTextEvent = {
  phoneNumberId: string
  from: string
  messageId: string | null
  text: string
}

function getQueryValue(query: Request['query'], key: string): string | null {
  const value = query[key]
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0]
  }
  return null
}

function extractIncomingTextEvents(payload: unknown): IncomingWhatsAppTextEvent[] {
  if (!payload || typeof payload !== 'object') {
    return []
  }

  const root = payload as { entry?: unknown[] }
  const entries = Array.isArray(root.entry) ? root.entry : []
  const events: IncomingWhatsAppTextEvent[] = []

  for (const entry of entries) {
    const changes = Array.isArray((entry as { changes?: unknown[] })?.changes)
      ? ((entry as { changes?: unknown[] }).changes ?? [])
      : []

    for (const change of changes) {
      const value = (change as { value?: unknown })?.value
      if (!value || typeof value !== 'object') {
        continue
      }

      const phoneNumberId = (value as { metadata?: { phone_number_id?: unknown } })?.metadata?.phone_number_id
      if (typeof phoneNumberId !== 'string' || phoneNumberId.trim().length === 0) {
        continue
      }

      const messages = Array.isArray((value as { messages?: unknown[] })?.messages)
        ? ((value as { messages?: unknown[] }).messages ?? [])
        : []

      for (const message of messages) {
        const messageRecord = message as {
          id?: unknown
          from?: unknown
          type?: unknown
          text?: { body?: unknown }
        }

        if (messageRecord.type !== 'text') {
          continue
        }

        const rawText = messageRecord.text?.body
        const rawFrom = messageRecord.from
        if (typeof rawText !== 'string' || typeof rawFrom !== 'string') {
          continue
        }

        const from = normalizeWhatsAppAddress(rawFrom)
        const text = rawText.trim()
        if (!from || !text) {
          continue
        }

        events.push({
          phoneNumberId: phoneNumberId.trim(),
          from,
          messageId: typeof messageRecord.id === 'string' ? messageRecord.id : null,
          text,
        })
      }
    }
  }

  return events
}

async function resolveAssistantName(
  supabaseAdminClient: SupabaseClient,
  chatbotId: string,
  fallback: string,
): Promise<string> {
  const { data, error } = await supabaseAdminClient
    .from('chatbot_settings')
    .select('bot_name')
    .eq('chatbot_id', chatbotId)
    .maybeSingle<{ bot_name: string }>()

  if (error) {
    throw new AppError(`Failed to load chatbot settings: ${error.message}`, 500)
  }

  return data?.bot_name?.trim() || fallback
}

async function generateWhatsAppReply(args: {
  integration: WhatsAppIntegrationRow
  userRole: 'user' | 'admin'
  incomingText: string
  options: WhatsAppRouterOptions
}): Promise<string> {
  const { options } = args
  if (!options.openAiApiKey || !options.openAiClient) {
    return 'Thanks for your message. Our assistant is temporarily unavailable. Please try again shortly.'
  }

  const chatbot = await loadChatbotById(
    options.supabaseAdminClient,
    args.integration.chatbot_id,
  )
  if (!chatbot || !chatbot.is_active) {
    throw new AppError('Connected chatbot is missing or inactive', 404)
  }

  const client = args.integration.client_id
    ? await loadClientById(options.supabaseAdminClient, args.integration.client_id)
    : chatbot.client_id
      ? await loadClientById(options.supabaseAdminClient, chatbot.client_id)
      : null

  const shouldUseGlobalKnowledge = args.userRole === 'admin'
  const baseKnowledge = shouldUseGlobalKnowledge
    ? await options.dataStore.getKnowledgeText()
    : ''

  const clientKnowledge =
    client && client.id
      ? await loadClientKnowledgeText(
          options.supabaseAdminClient,
          client.id,
          client.knowledge_base_text,
        )
      : ''

  const ragChunks = await retrieveRelevantChunks({
    supabaseAdminClient: options.supabaseAdminClient,
    openAiClient: options.openAiClient,
    chatbotId: chatbot.id,
    queryText: args.incomingText,
    topK: 8,
  })

  const ragContext = ragChunks
    .map(
      (chunk, index) =>
        `Source ${index + 1}: ${chunk.url}\n${chunk.chunkText}`,
    )
    .join('\n\n')

  const assistantName = await resolveAssistantName(
    options.supabaseAdminClient,
    chatbot.id,
    chatbot.name,
  )

  const strictContextInstruction = [
    'You are a business assistant for WhatsApp conversations.',
    'Use only the provided context to answer.',
    "If the answer is not in the context, say you don't know and suggest contacting the business directly.",
    'Do not fabricate facts or policies.',
    'Keep replies concise and practical for mobile chat.',
  ].join(' ')

  const systemPrompt = [
    strictContextInstruction,
    buildSystemPrompt([baseKnowledge, clientKnowledge].filter(Boolean).join('\n\n'), {
      assistantName,
      businessName: client?.business_name ?? null,
    }),
    ragContext
      ? `Website Context:\n${ragContext}`
      : 'Website Context:\nNo relevant website context was retrieved.',
  ].join('\n\n')

  const completion = await options.openAiClient.chat.completions.create({
    model: options.openAiModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: args.incomingText },
    ],
    temperature: 0.4,
  })

  return (
    completion.choices?.[0]?.message?.content?.trim() ||
    "Thanks for your message. I'll share this with the team."
  )
}

async function processIncomingTextEvent(args: {
  event: IncomingWhatsAppTextEvent
  options: WhatsAppRouterOptions
}): Promise<void> {
  const { event, options } = args
  const integration = await loadWhatsAppIntegrationByPhoneNumberId(
    options.supabaseAdminClient,
    event.phoneNumberId,
  )

  if (!integration || !integration.is_active) {
    return
  }

  const ownerUser = await loadUserById(options.supabaseAdminClient, integration.user_id)
  if (!ownerUser) {
    return
  }

  const usage = await enforcePlanMessageLimit(
    options.supabaseAdminClient,
    ownerUser.id,
    ownerUser.role,
  )

  if (!usage.allowed || !usage.subscription) {
    await sendWhatsAppTextMessage({
      graphApiVersion: options.whatsappGraphApiVersion,
      accessToken: integration.access_token,
      phoneNumberId: integration.phone_number_id,
      to: event.from,
      text:
        usage.reason ||
        'Your chatbot has reached its current plan limit. Please contact support to continue.',
    })
    return
  }

  const reply = await generateWhatsAppReply({
    integration,
    userRole: ownerUser.role,
    incomingText: event.text,
    options,
  })

  await sendWhatsAppTextMessage({
    graphApiVersion: options.whatsappGraphApiVersion,
    accessToken: integration.access_token,
    phoneNumberId: integration.phone_number_id,
    to: event.from,
    text: reply,
  })

  const sessionId = `whatsapp:${event.from}`
  await storeChatMessages({
    supabaseAdminClient: options.supabaseAdminClient,
    userId: ownerUser.id,
    chatbotId: integration.chatbot_id,
    sessionId,
    userMessage: event.text,
    assistantMessage: reply,
  })

  if (ownerUser.role !== 'admin') {
    await incrementSubscriptionUsage(
      options.supabaseAdminClient,
      usage.subscription,
      1,
    )
  }

  const leadCaptured = integration.client_id
    ? await upsertLeadFromMessage(options.supabaseAdminClient, {
        clientId: integration.client_id,
        content: event.text,
        sessionId,
      })
    : false

  await insertChatHistoryRow({
    supabaseAdminClient: options.supabaseAdminClient,
    chatbotId: integration.chatbot_id,
    visitorId: event.from,
    userMessage: event.text,
    botResponse: reply,
    leadCaptured,
  })

  await updateWhatsAppIntegrationLastInboundAt(
    options.supabaseAdminClient,
    integration.id,
  )

  await options.dataStore.appendJsonLine('whatsapp_events.jsonl', {
    ts: getTimestamp(),
    integrationId: integration.id,
    chatbotId: integration.chatbot_id,
    phoneNumberId: integration.phone_number_id,
    from: event.from,
    inboundMessageId: event.messageId,
    leadCaptured,
    usageMessageEstimate: estimateTokens(event.text) + estimateTokens(reply),
  })
}

export function createWhatsAppRouter(options: WhatsAppRouterOptions): Router {
  const router = Router()

  router.get(
    '/webhook',
    asyncHandler(async (request, response) => {
      const mode = getQueryValue(request.query, 'hub.mode')
      const verifyToken = getQueryValue(request.query, 'hub.verify_token')
      const challenge = getQueryValue(request.query, 'hub.challenge')

      if (!mode || !verifyToken || !challenge) {
        throw new AppError('Missing webhook verification parameters', 400)
      }

      if (mode !== 'subscribe') {
        throw new AppError('Unsupported webhook mode', 400)
      }

      const integration = await loadWhatsAppIntegrationByVerifyToken(
        options.supabaseAdminClient,
        verifyToken,
      )

      if (!integration || !integration.is_active) {
        throw new AppError('Invalid verify token', 403)
      }

      response.status(200).send(challenge)
    }),
  )

  router.post(
    '/webhook',
    asyncHandler(async (request, response) => {
      const events = extractIncomingTextEvents(request.body)
      const errors: Array<{ phoneNumberId: string; from: string; reason: string }> = []

      for (const event of events) {
        try {
          await processIncomingTextEvent({
            event,
            options,
          })
        } catch (error) {
          errors.push({
            phoneNumberId: event.phoneNumberId,
            from: event.from,
            reason: error instanceof Error ? error.message : 'Unknown WhatsApp processing error',
          })
        }
      }

      if (errors.length > 0) {
        console.error(
          JSON.stringify({
            level: 'error',
            type: 'whatsapp_webhook_processing_failed',
            count: errors.length,
            errors,
          }),
        )
      }

      response.json({
        ok: true,
        processed: events.length,
        failed: errors.length,
      })
    }),
  )

  return router
}
