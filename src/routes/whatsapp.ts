import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { Router, type Request } from 'express'
import type OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'

import { authMiddleware, type AuthenticatedRequest } from '../lib/auth-middleware.js'
import { asyncHandler, AppError } from '../lib/errors.js'
import { getClientIp, getTimestamp, respondValidationError } from '../lib/http.js'
import { logError, logWarn } from '../lib/logger.js'
import { createFixedWindowLimiter } from '../lib/rateLimit.js'
import { getRequestIdFromRequest } from '../lib/requestContext.js'
import { buildSystemPrompt } from '../lib/systemPrompt.js'
import type { DataStore } from '../lib/dataStore.js'
import {
  whatsappOnboardingCompleteSchema,
  whatsappOnboardingStartSchema,
  whatsappWebhookPayloadSchema,
  whatsappWebhookSubscribeSchema,
} from '../schemas/whatsapp.js'
import { retrieveRelevantChunks } from '../rag/retrieval.js'
import {
  appendLeadCaptureAcknowledgement,
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
  loadClientByUserId,
  loadUserById,
  loadUserChatbots,
} from '../services/tenantService.js'
import {
  exchangeMetaCodeForAccessToken,
  extractEmbeddedSignupData,
  fetchMetaWabaPhoneNumbers,
  subscribeMetaWabaWebhook,
} from '../services/whatsappOnboardingService.js'
import {
  appendWhatsAppOnboardingLog,
  createWhatsAppVerifyToken,
  loadWhatsAppIntegrationByPhoneNumberId,
  loadWhatsAppIntegrationByUserId,
  loadWhatsAppIntegrationByVerifyToken,
  normalizeWhatsAppAddress,
  sendWhatsAppTextMessage,
  updateWhatsAppIntegrationLastInboundAt,
  upsertWhatsAppIntegration,
  type WhatsAppIntegrationRow,
} from '../services/whatsappService.js'

type WhatsAppRouterOptions = {
  supabaseAdminClient: SupabaseClient
  openAiApiKey: string
  openAiModel: string
  openAiClient: OpenAI | null
  dataStore: DataStore
  whatsappGraphApiVersion: string
  jwtSecret: string
  backendBaseUrl: string
  frontendUrl: string
  metaAppId: string
  metaAppSecret: string
  metaVerifyToken: string
  metaGraphApiVersion: string
  metaRedirectUri: string
  metaEmbeddedSignupConfigId: string
  webhookAllowedIps: string[]
  webhookRateLimitPerMinute: number
}

type IncomingWhatsAppTextEvent = {
  phoneNumberId: string
  from: string
  messageId: string | null
  text: string
}

type RequestWithRawBody = Request & {
  rawBody?: Buffer
}

function asAuthenticatedRequest(request: unknown): AuthenticatedRequest {
  return request as AuthenticatedRequest
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function coalesceNonEmpty(...values: Array<unknown>): string | null {
  for (const value of values) {
    const normalized = normalizeString(value)
    if (normalized) {
      return normalized
    }
  }
  return null
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

function isHexString(value: string): boolean {
  return /^[a-f0-9]+$/i.test(value)
}

function assertWebhookSourceAllowed(request: Request, allowedIps: string[]): void {
  if (allowedIps.length === 0) {
    return
  }

  const requestIp = getClientIp(request)
  if (!allowedIps.includes(requestIp)) {
    throw new AppError('Webhook source is not allowed', 403)
  }
}

function assertWebhookSignature(request: Request, appSecret: string): void {
  if (!appSecret) {
    return
  }

  const signatureHeader = request.header('x-hub-signature-256')?.trim()
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    throw new AppError('Invalid webhook signature', 401)
  }

  const providedSignature = signatureHeader.slice('sha256='.length)
  if (!providedSignature || !isHexString(providedSignature) || providedSignature.length % 2 !== 0) {
    throw new AppError('Invalid webhook signature', 401)
  }

  const rawBody = (request as RequestWithRawBody).rawBody
  if (!rawBody || rawBody.length === 0) {
    throw new AppError('Invalid webhook payload signature', 401)
  }

  const expectedSignature = createHmac('sha256', appSecret).update(rawBody).digest('hex')
  const providedBuffer = Buffer.from(providedSignature, 'hex')
  const expectedBuffer = Buffer.from(expectedSignature, 'hex')

  if (providedBuffer.length !== expectedBuffer.length) {
    throw new AppError('Invalid webhook signature', 401)
  }

  if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw new AppError('Invalid webhook signature', 401)
  }
}

function toIntegrationPayload(integration: WhatsAppIntegrationRow | null) {
  if (!integration) {
    return null
  }

  return {
    id: integration.id,
    chatbot_id: integration.chatbot_id,
    phone_number_id: integration.phone_number_id,
    business_phone_number_id: integration.business_phone_number_id,
    business_account_id: integration.business_account_id,
    whatsapp_business_account_id: integration.whatsapp_business_account_id,
    phone_number: integration.phone_number,
    display_phone_number: integration.display_phone_number,
    verify_token: integration.verify_token,
    status: integration.status,
    webhook_subscribed: integration.webhook_subscribed,
    is_active: integration.is_active,
    last_inbound_at: integration.last_inbound_at,
    created_at: integration.created_at,
    updated_at: integration.updated_at,
    has_access_token: Boolean(integration.access_token),
  }
}

async function safeAppendOnboardingLog(
  supabaseAdminClient: SupabaseClient,
  args: {
    integrationId?: string | null
    userId: string
    clientId?: string | null
    chatbotId?: string | null
    eventType: string
    payload?: Record<string, unknown>
  },
) {
  try {
    await appendWhatsAppOnboardingLog(supabaseAdminClient, args)
  } catch (error) {
    logError({
      type: 'whatsapp_onboarding_log_failed',
      eventType: args.eventType,
      message: error instanceof Error ? error.message : 'Unknown onboarding log failure',
    })
  }
}

async function resolveOnboardingChatbot(args: {
  supabaseAdminClient: SupabaseClient
  userId: string
  requestedChatbotId: string | null
}) {
  const chatbots = await loadUserChatbots(args.supabaseAdminClient, args.userId)
  if (chatbots.length === 0) {
    throw new AppError('Create at least one chatbot before connecting WhatsApp', 400)
  }

  if (!args.requestedChatbotId) {
    return {
      selected: chatbots[0],
      chatbots,
    }
  }

  const selected = chatbots.find((chatbot) => chatbot.id === args.requestedChatbotId)
  if (!selected) {
    throw new AppError('Selected chatbot is not available for this user', 404)
  }

  return { selected, chatbots }
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

  const aiReply = await generateWhatsAppReply({
    integration,
    userRole: ownerUser.role,
    incomingText: event.text,
    options,
  })

  const sessionId = `whatsapp:${event.from}`
  const linkedChatbot = await loadChatbotById(
    options.supabaseAdminClient,
    integration.chatbot_id,
  )
  const fallbackClient = await loadClientByUserId(
    options.supabaseAdminClient,
    ownerUser.id,
  )
  const resolvedClientId =
    integration.client_id ?? linkedChatbot?.client_id ?? fallbackClient?.id ?? null

  const leadCaptureResult = resolvedClientId
    ? await upsertLeadFromMessage(options.supabaseAdminClient, {
        clientId: resolvedClientId,
        content: event.text,
        sessionId,
      })
    : {
        captured: false,
        email: null,
        phone: null,
        leadText: null,
        hasDemoIntent: false,
      }

  const leadCaptured = leadCaptureResult.captured
  if (!resolvedClientId) {
    logWarn({
      type: 'whatsapp_lead_capture_skipped_missing_client',
      path: '/api/whatsapp/webhook',
      userId: ownerUser.id,
      chatbotId: integration.chatbot_id,
      integrationId: integration.id,
    })
  }
  const reply = appendLeadCaptureAcknowledgement(aiReply, leadCaptured)

  await sendWhatsAppTextMessage({
    graphApiVersion: options.whatsappGraphApiVersion,
    accessToken: integration.access_token,
    phoneNumberId: integration.phone_number_id,
    to: event.from,
    text: reply,
  })

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
  const webhookLimiter = createFixedWindowLimiter({
    namespace: 'webhook',
    windowMs: 60 * 1000,
    max: options.webhookRateLimitPerMinute,
    message: 'Too many webhook requests. Please try again later.',
  })

  router.get(
    '/callback',
    asyncHandler(async (request, response) => {
      const status = getQueryValue(request.query, 'status') ?? 'success'
      const reason = getQueryValue(request.query, 'reason')
      const frontendBase = trimTrailingSlash(options.frontendUrl) || 'http://localhost:5173'
      const redirectUrl = new URL('/dashboard/integrations/whatsapp/connect', `${frontendBase}/`)
      redirectUrl.searchParams.set('status', status)
      if (reason) {
        redirectUrl.searchParams.set('reason', reason)
      }

      response.redirect(302, redirectUrl.toString())
    }),
  )

  router.post(
    '/onboarding/start',
    authMiddleware(options.jwtSecret),
    asyncHandler(async (request, response) => {
      const parsed = whatsappOnboardingStartSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const authRequest = asAuthenticatedRequest(request)
      const user = await loadUserById(options.supabaseAdminClient, authRequest.user.userId)
      if (!user) {
        throw new AppError('Unauthorized', 401)
      }

      const requestedChatbotId = coalesceNonEmpty(parsed.data.chatbotId)
      const { selected, chatbots } = await resolveOnboardingChatbot({
        supabaseAdminClient: options.supabaseAdminClient,
        userId: authRequest.user.userId,
        requestedChatbotId,
      })

      const existingIntegration = await loadWhatsAppIntegrationByUserId(
        options.supabaseAdminClient,
        authRequest.user.userId,
      )

      const verifyToken = existingIntegration?.verify_token || createWhatsAppVerifyToken()
      const onboardingState = randomBytes(18).toString('hex')

      if (existingIntegration) {
        await upsertWhatsAppIntegration(options.supabaseAdminClient, {
          userId: authRequest.user.userId,
          clientId: selected.client_id ?? authRequest.user.clientId,
          chatbotId: selected.id,
          phoneNumberId: existingIntegration.phone_number_id,
          businessPhoneNumberId:
            existingIntegration.business_phone_number_id ?? existingIntegration.phone_number_id,
          businessAccountId: existingIntegration.business_account_id,
          whatsappBusinessAccountId: existingIntegration.whatsapp_business_account_id,
          phoneNumber: existingIntegration.phone_number,
          displayPhoneNumber: existingIntegration.display_phone_number,
          accessToken: existingIntegration.access_token,
          verifyToken,
          webhookSecret: existingIntegration.webhook_secret,
          status: 'connecting',
          onboardingPayload: {
            stage: 'start',
            state: onboardingState,
            requestedState: parsed.data.state || null,
            startedAt: new Date().toISOString(),
          },
          webhookSubscribed: existingIntegration.webhook_subscribed,
          isActive: existingIntegration.is_active,
        })
      }

      await safeAppendOnboardingLog(options.supabaseAdminClient, {
        integrationId: existingIntegration?.id ?? null,
        userId: authRequest.user.userId,
        clientId: selected.client_id ?? authRequest.user.clientId,
        chatbotId: selected.id,
        eventType: 'start',
        payload: {
          state: onboardingState,
          requestedState: parsed.data.state || null,
        },
      })

      const webhookUrl = `${trimTrailingSlash(options.backendBaseUrl)}/api/whatsapp/webhook`
      const redirectUri =
        options.metaRedirectUri ||
        `${trimTrailingSlash(options.frontendUrl)}/dashboard/integrations/whatsapp/connect`

      response.json({
        ok: true,
        onboarding: {
          state: onboardingState,
          chatbotId: selected.id,
          metaAppId: options.metaAppId || null,
          configId: options.metaEmbeddedSignupConfigId || null,
          redirectUri,
          graphApiVersion: options.metaGraphApiVersion,
          webhookUrl,
          verifyToken,
        },
        chatbots: chatbots.map((chatbot) => ({
          id: chatbot.id,
          name: chatbot.name,
        })),
      })
    }),
  )

  router.post(
    '/onboarding/complete',
    authMiddleware(options.jwtSecret),
    asyncHandler(async (request, response) => {
      const parsed = whatsappOnboardingCompleteSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const authRequest = asAuthenticatedRequest(request)
      const user = await loadUserById(options.supabaseAdminClient, authRequest.user.userId)
      if (!user) {
        throw new AppError('Unauthorized', 401)
      }

      const requestedChatbotId = coalesceNonEmpty(parsed.data.chatbotId)
      const { selected } = await resolveOnboardingChatbot({
        supabaseAdminClient: options.supabaseAdminClient,
        userId: authRequest.user.userId,
        requestedChatbotId,
      })

      const existingIntegration = await loadWhatsAppIntegrationByUserId(
        options.supabaseAdminClient,
        authRequest.user.userId,
      )

      const extracted = extractEmbeddedSignupData(parsed.data.onboardingPayload)
      const accessTokenFromPayload = coalesceNonEmpty(
        parsed.data.accessToken,
        parsed.data.authResponse?.accessToken,
        extracted.accessToken,
      )
      const oauthCode = coalesceNonEmpty(
        parsed.data.code,
        parsed.data.authResponse?.code,
        extracted.oauthCode,
      )

      let accessToken = accessTokenFromPayload || existingIntegration?.access_token || ''
      if (!accessToken && oauthCode) {
        accessToken = await exchangeMetaCodeForAccessToken({
          graphApiVersion: options.metaGraphApiVersion,
          appId: options.metaAppId,
          appSecret: options.metaAppSecret,
          redirectUri:
            options.metaRedirectUri ||
            `${trimTrailingSlash(options.frontendUrl)}/dashboard/integrations/whatsapp/connect`,
          code: oauthCode,
        })
      }

      if (!accessToken) {
        throw new AppError('Embedded signup did not return an access token', 400)
      }

      let businessAccountId = coalesceNonEmpty(
        parsed.data.businessAccountId,
        extracted.businessAccountId,
        existingIntegration?.whatsapp_business_account_id,
        existingIntegration?.business_account_id,
      )
      let phoneNumberId = coalesceNonEmpty(
        parsed.data.phoneNumberId,
        extracted.phoneNumberId,
        existingIntegration?.business_phone_number_id,
        existingIntegration?.phone_number_id,
      )
      let displayPhoneNumber = coalesceNonEmpty(
        parsed.data.displayPhoneNumber,
        extracted.displayPhoneNumber,
        existingIntegration?.display_phone_number,
      )
      const phoneNumber = coalesceNonEmpty(
        parsed.data.phoneNumber,
        extracted.phoneNumber,
        existingIntegration?.phone_number,
      )

      if (businessAccountId && !phoneNumberId) {
        const phoneNumbers = await fetchMetaWabaPhoneNumbers({
          graphApiVersion: options.metaGraphApiVersion,
          accessToken,
          wabaId: businessAccountId,
        })
        if (phoneNumbers.length > 0) {
          phoneNumberId = phoneNumbers[0].id
          displayPhoneNumber = displayPhoneNumber || phoneNumbers[0].displayPhoneNumber
        }
      }

      if (!phoneNumberId) {
        throw new AppError('Embedded signup did not return a WhatsApp phone number id', 400)
      }

      const verifyToken = coalesceNonEmpty(
        parsed.data.verifyToken,
        existingIntegration?.verify_token,
      ) || createWhatsAppVerifyToken()

      const webhookUrl = `${trimTrailingSlash(options.backendBaseUrl)}/api/whatsapp/webhook`

      let subscribeResult = {
        ok: false,
        message: 'Webhook subscription was skipped.',
        status: null as number | null,
        payload: {} as unknown,
      }

      if (parsed.data.autoSubscribe !== false && businessAccountId) {
        subscribeResult = await subscribeMetaWabaWebhook({
          graphApiVersion: options.metaGraphApiVersion,
          accessToken,
          wabaId: businessAccountId,
          webhookUrl,
          verifyToken,
        })
      } else if (!businessAccountId) {
        subscribeResult = {
          ok: false,
          message: 'Business account id is missing. Cannot auto-subscribe webhook.',
          status: null,
          payload: {},
        }
      }

      const integration = await upsertWhatsAppIntegration(
        options.supabaseAdminClient,
        {
          userId: authRequest.user.userId,
          clientId: selected.client_id ?? authRequest.user.clientId,
          chatbotId: selected.id,
          phoneNumberId,
          businessPhoneNumberId: phoneNumberId,
          businessAccountId,
          whatsappBusinessAccountId: businessAccountId,
          phoneNumber,
          displayPhoneNumber,
          accessToken,
          verifyToken,
          webhookSecret: existingIntegration?.webhook_secret ?? null,
          status: subscribeResult.ok ? 'connected' : 'failed',
          onboardingPayload: {
            stage: 'complete',
            state: parsed.data.state || null,
            receivedAt: new Date().toISOString(),
            embeddedPayload: parsed.data.onboardingPayload ?? null,
            autoSubscribe: parsed.data.autoSubscribe !== false,
            subscribeResult: {
              ok: subscribeResult.ok,
              message: subscribeResult.message,
              status: subscribeResult.status,
            },
          },
          webhookSubscribed: subscribeResult.ok,
          isActive: parsed.data.isActive,
        },
      )

      await safeAppendOnboardingLog(options.supabaseAdminClient, {
        integrationId: integration.id,
        userId: authRequest.user.userId,
        clientId: integration.client_id,
        chatbotId: integration.chatbot_id,
        eventType: subscribeResult.ok ? 'complete_success' : 'complete_failed',
        payload: {
          state: parsed.data.state || null,
          subscribe: {
            ok: subscribeResult.ok,
            message: subscribeResult.message,
            status: subscribeResult.status,
          },
        },
      })

      response.json({
        ok: true,
        connected: integration.status === 'connected',
        webhookUrl,
        integration: toIntegrationPayload(integration),
        subscribe: subscribeResult,
      })
    }),
  )

  router.get(
    '/status',
    authMiddleware(options.jwtSecret),
    asyncHandler(async (request, response) => {
      const authRequest = asAuthenticatedRequest(request)
      const integration = await loadWhatsAppIntegrationByUserId(
        options.supabaseAdminClient,
        authRequest.user.userId,
      )

      response.json({
        ok: true,
        connected: integration?.status === 'connected' && integration?.is_active === true,
        webhookUrl: `${trimTrailingSlash(options.backendBaseUrl)}/api/whatsapp/webhook`,
        integration: toIntegrationPayload(integration),
      })
    }),
  )

  router.post(
    '/webhooks/subscribe',
    authMiddleware(options.jwtSecret),
    asyncHandler(async (request, response) => {
      const parsed = whatsappWebhookSubscribeSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const authRequest = asAuthenticatedRequest(request)
      const integration = await loadWhatsAppIntegrationByUserId(
        options.supabaseAdminClient,
        authRequest.user.userId,
      )

      if (!integration) {
        throw new AppError('WhatsApp integration is not connected', 404)
      }

      const businessAccountId =
        integration.whatsapp_business_account_id || integration.business_account_id
      if (!businessAccountId) {
        throw new AppError('Business account id is required for webhook subscription', 400)
      }

      const verifyToken =
        coalesceNonEmpty(parsed.data.verifyToken, integration.verify_token) ||
        createWhatsAppVerifyToken()
      const webhookUrl = `${trimTrailingSlash(options.backendBaseUrl)}/api/whatsapp/webhook`

      const subscribeResult = await subscribeMetaWabaWebhook({
        graphApiVersion: options.metaGraphApiVersion,
        accessToken: integration.access_token,
        wabaId: businessAccountId,
        webhookUrl,
        verifyToken,
      })

      const nextIntegration = await upsertWhatsAppIntegration(
        options.supabaseAdminClient,
        {
          userId: authRequest.user.userId,
          clientId: integration.client_id,
          chatbotId: integration.chatbot_id,
          phoneNumberId: integration.phone_number_id,
          businessPhoneNumberId: integration.business_phone_number_id ?? integration.phone_number_id,
          businessAccountId: integration.business_account_id,
          whatsappBusinessAccountId: integration.whatsapp_business_account_id,
          phoneNumber: integration.phone_number,
          displayPhoneNumber: integration.display_phone_number,
          accessToken: integration.access_token,
          verifyToken,
          webhookSecret: integration.webhook_secret,
          status: subscribeResult.ok ? 'connected' : 'failed',
          onboardingPayload: {
            ...(integration.onboarding_payload ?? {}),
            webhookSubscribeRetryAt: new Date().toISOString(),
            webhookSubscribeResult: {
              ok: subscribeResult.ok,
              message: subscribeResult.message,
              status: subscribeResult.status,
            },
          },
          webhookSubscribed: subscribeResult.ok,
          isActive: integration.is_active,
        },
      )

      await safeAppendOnboardingLog(options.supabaseAdminClient, {
        integrationId: integration.id,
        userId: authRequest.user.userId,
        clientId: integration.client_id,
        chatbotId: integration.chatbot_id,
        eventType: subscribeResult.ok ? 'subscribe_success' : 'subscribe_failed',
        payload: {
          message: subscribeResult.message,
          status: subscribeResult.status,
        },
      })

      response.json({
        ok: true,
        connected: nextIntegration.status === 'connected',
        webhookUrl,
        integration: toIntegrationPayload(nextIntegration),
        subscribe: subscribeResult,
      })
    }),
  )

  router.get(
    '/webhook',
    webhookLimiter,
    asyncHandler(async (request, response) => {
      assertWebhookSourceAllowed(request, options.webhookAllowedIps)

      const mode = getQueryValue(request.query, 'hub.mode')
      const verifyToken = getQueryValue(request.query, 'hub.verify_token')
      const challenge = getQueryValue(request.query, 'hub.challenge')

      if (!mode || !verifyToken || !challenge) {
        throw new AppError('Missing webhook verification parameters', 400)
      }

      if (mode !== 'subscribe') {
        throw new AppError('Unsupported webhook mode', 400)
      }

      if (options.metaVerifyToken && verifyToken === options.metaVerifyToken) {
        response.status(200).send(challenge)
        return
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
    webhookLimiter,
    asyncHandler(async (request, response) => {
      assertWebhookSourceAllowed(request, options.webhookAllowedIps)
      assertWebhookSignature(request, options.metaAppSecret)

      const parsedPayload = whatsappWebhookPayloadSchema.safeParse(request.body)
      if (!parsedPayload.success) {
        return respondValidationError(parsedPayload.error, response)
      }

      const events = extractIncomingTextEvents(parsedPayload.data)
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
        logError({
          type: 'whatsapp_webhook_processing_failed',
          requestId: getRequestIdFromRequest(request),
          path: '/api/whatsapp/webhook',
          count: errors.length,
          errors,
        })
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
