import { Router, type Request } from 'express'
import type OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'

import { getOptionalRequestUser } from '../lib/auth-middleware.js'
import { asyncHandler, AppError } from '../lib/errors.js'
import { getClientIp, getTimestamp, hashIp, respondValidationError } from '../lib/http.js'
import { createInMemoryLimiter } from '../lib/rateLimit.js'
import { sanitizeMessages } from '../lib/sanitizeMessages.js'
import { buildSystemPrompt } from '../lib/systemPrompt.js'
import { chatSchema, chatLogSchema } from '../schemas/api.js'
import {
  estimateTokens,
  loadClientKnowledgeText,
  storeChatMessages,
  upsertLeadFromMessage,
} from '../services/chatService.js'
import {
  enforcePlanMessageLimit,
  incrementSubscriptionUsage,
  loadPlanByCode,
  type PlanRow,
  type SubscriptionRow,
} from '../services/subscriptionService.js'
import {
  extractDomainFromRequestOrigin,
  ensureDefaultChatbot,
  loadChatbotByPublicKey,
  loadChatbotById,
  loadClientById,
  loadClientByUserId,
  loadUserById,
} from '../services/tenantService.js'
import type { DataStore } from '../lib/dataStore.js'

type ChatRouterOptions = {
  jwtSecret: string
  openAiApiKey: string
  openAiModel: string
  openAiClient: OpenAI | null
  supabaseAdminClient: SupabaseClient
  dataStore: DataStore
}

type ChatContext = {
  mode: 'public' | 'dashboard' | 'widget'
  userId: string | null
  clientId: string | null
  chatbotId: string | null
  userRole: 'user' | 'admin'
  plan: PlanRow | null
  subscription: SubscriptionRow | null
}

function pickSessionId(input: string | undefined): string {
  const trimmed = (input ?? '').trim()
  if (trimmed.length === 0) {
    return `session_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }
  return trimmed.slice(0, 120)
}

function findLastUserMessage(messages: Array<{ role: 'user' | 'assistant'; content: string }>): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return messages[index].content
    }
  }
  return ''
}

function isDomainAllowed(domain: string | null, allowedDomains: string[]): boolean {
  if (!domain) {
    return true
  }

  if (allowedDomains.length === 0) {
    return true
  }

  return allowedDomains.some((allowedDomain) => {
    const normalizedAllowed = allowedDomain.toLowerCase()
    return domain === normalizedAllowed || domain.endsWith(`.${normalizedAllowed}`)
  })
}

async function resolveChatContext(
  request: Request,
  body: {
    key?: string
    chatbot_id?: string
    client_id?: string
    metadata?: { key?: string; chatbot_id?: string; client_id?: string }
  },
  options: ChatRouterOptions,
): Promise<ChatContext> {
  const authUser = getOptionalRequestUser(request, options.jwtSecret)
  const providedKey = body.key || body.metadata?.key || (typeof request.query.key === 'string' ? request.query.key : undefined)
  const providedChatbotId = body.chatbot_id || body.metadata?.chatbot_id

  if (authUser) {
    const user = await loadUserById(options.supabaseAdminClient, authUser.userId)
    if (!user) {
      throw new AppError('Unauthorized', 401)
    }

    let chatbotId = providedChatbotId || null
    let resolvedClientId = authUser.clientId
    if (chatbotId) {
      const chatbot = await loadChatbotById(options.supabaseAdminClient, chatbotId)
      if (!chatbot || chatbot.user_id !== user.id) {
        throw new AppError('Chatbot not found', 404)
      }
      resolvedClientId = chatbot.client_id ?? authUser.clientId
    }

    if (!chatbotId) {
      const defaultClient = await loadClientByUserId(options.supabaseAdminClient, user.id)
      if (!defaultClient) {
        throw new AppError('Client profile missing', 500)
      }

      const defaultChatbot = await ensureDefaultChatbot(options.supabaseAdminClient, {
        userId: user.id,
        clientId: defaultClient.id,
        websiteUrl: defaultClient.website_url,
        businessName: defaultClient.business_name,
      })

      chatbotId = defaultChatbot.id
      resolvedClientId = defaultClient.id
    }

    const usage = await enforcePlanMessageLimit(options.supabaseAdminClient, user.id, user.role)
    if (!usage.allowed) {
      throw new AppError(usage.reason || 'Plan usage limit reached', 403)
    }
    return {
      mode: 'dashboard',
      userId: user.id,
      clientId: resolvedClientId,
      chatbotId,
      userRole: user.role,
      plan: usage.plan,
      subscription: usage.subscription,
    }
  }

  if (providedKey) {
    const chatbot = await loadChatbotByPublicKey(options.supabaseAdminClient, providedKey)
    if (!chatbot || !chatbot.is_active) {
      throw new AppError('Invalid widget key', 404)
    }

    const originDomain = extractDomainFromRequestOrigin(request.header('origin') ?? null)
    const refererDomain = extractDomainFromRequestOrigin(request.header('referer') ?? null)
    const requestDomain = originDomain || refererDomain

    const allowedDomains = Array.isArray(chatbot.allowed_domains)
      ? chatbot.allowed_domains
      : []

    if (!isDomainAllowed(requestDomain, allowedDomains)) {
      throw new AppError('Widget origin is not allowed', 403)
    }

    const ownerUser = await loadUserById(options.supabaseAdminClient, chatbot.user_id)
    if (!ownerUser) {
      throw new AppError('Widget owner user not found', 500)
    }

    const usage = await enforcePlanMessageLimit(options.supabaseAdminClient, ownerUser.id, ownerUser.role)
    if (!usage.allowed) {
      throw new AppError(usage.reason || 'Plan usage limit reached', 403)
    }

    return {
      mode: 'widget',
      userId: ownerUser.id,
      clientId: chatbot.client_id,
      chatbotId: chatbot.id,
      userRole: ownerUser.role,
      plan: usage.plan,
      subscription: usage.subscription,
    }
  }

  return {
    mode: 'public',
    userId: null,
    clientId: null,
    chatbotId: null,
    userRole: 'user',
    plan: null,
    subscription: null,
  }
}

function requireLimitAllowed(planCheck: { allowed: boolean; reason?: string }) {
  if (!planCheck.allowed) {
    throw new AppError(planCheck.reason || 'Usage limit reached', 403)
  }
}

export function createChatRouter(options: ChatRouterOptions): Router {
  const router = Router()

  const chatLimiter = createInMemoryLimiter({
    windowMs: 10 * 60 * 1000,
    max: 60,
    keyGenerator: (request) => {
      const ip = getClientIp(request)
      const keyFromQuery = typeof request.query.key === 'string' ? request.query.key : ''
      const keyFromBody = typeof (request.body as { key?: unknown })?.key === 'string'
        ? ((request.body as { key?: string }).key ?? '')
        : ''
      return `${ip}:${keyFromBody || keyFromQuery || 'no-key'}`
    },
    message: 'Too many chat requests. Please try again later.',
  })

  router.post(
    '/chat',
    chatLimiter,
    asyncHandler(async (request, response) => {
      const parsed = chatSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const sanitizedMessages = sanitizeMessages(parsed.data.messages, 12)
      if (sanitizedMessages.length === 0) {
        throw new AppError('No valid messages provided.', 400)
      }

      const sessionId = pickSessionId(parsed.data.sessionId)
      const lastUserMessage = findLastUserMessage(sanitizedMessages)

      if (!lastUserMessage) {
        throw new AppError('At least one user message is required.', 400)
      }

      const context = await resolveChatContext(request, parsed.data, options)

      if (context.userId && context.userRole !== 'admin') {
        const usage = await enforcePlanMessageLimit(options.supabaseAdminClient, context.userId, context.userRole)
        requireLimitAllowed(usage)
        context.plan = usage.plan
        context.subscription = usage.subscription
      }

      const baseKnowledge = await options.dataStore.getKnowledgeText()

      let clientKnowledge = ''
      if (context.clientId) {
        const client = await loadClientById(options.supabaseAdminClient, context.clientId)
        if (client) {
          clientKnowledge = await loadClientKnowledgeText(
            options.supabaseAdminClient,
            context.clientId,
            client.knowledge_base_text,
          )
        }
      }

      const mergedKnowledge = [baseKnowledge, clientKnowledge].filter(Boolean).join('\n\n')

      if (!options.openAiApiKey || !options.openAiClient) {
        return response.json({
          ok: true,
          reply: 'OPENAI_API_KEY missing on server.',
          usage: context.subscription,
        })
      }

      const systemPrompt = buildSystemPrompt(mergedKnowledge)

      const completion = await options.openAiClient.chat.completions.create({
        model: options.openAiModel,
        messages: [
          { role: 'system', content: systemPrompt },
          ...sanitizedMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
        temperature: 0.4,
      })

      const reply = completion.choices?.[0]?.message?.content?.trim() || "Sorry - I couldn't generate a response."

      if (context.userId && context.chatbotId) {
        await storeChatMessages({
          supabaseAdminClient: options.supabaseAdminClient,
          userId: context.userId,
          chatbotId: context.chatbotId,
          sessionId,
          userMessage: lastUserMessage,
          assistantMessage: reply,
        })
      }

      if (context.userId && context.userRole !== 'admin' && context.subscription) {
        const updatedSubscription = await incrementSubscriptionUsage(
          options.supabaseAdminClient,
          context.subscription,
          1,
        )
        context.subscription = updatedSubscription
        if (context.plan) {
          context.plan = await loadPlanByCode(options.supabaseAdminClient, updatedSubscription.plan_code)
        }
      }

      if (context.clientId) {
        await upsertLeadFromMessage(options.supabaseAdminClient, {
          clientId: context.clientId,
          content: lastUserMessage,
          sessionId,
        })
      }

      await options.dataStore.appendJsonLine('chats_ai.jsonl', {
        ts: getTimestamp(),
        ipHash: hashIp(getClientIp(request)),
        sessionId,
        page: parsed.data.metadata?.page ?? null,
        mode: context.mode,
        userId: context.userId,
        clientId: context.clientId,
        chatbotId: context.chatbotId,
        model: options.openAiModel,
        usageMessageEstimate: estimateTokens(lastUserMessage) + estimateTokens(reply),
      })

      response.json({
        ok: true,
        reply,
        mode: context.mode,
        subscription: context.subscription,
        plan: context.plan,
      })
    }),
  )

  router.post(
    '/chat/log',
    asyncHandler(async (request, response) => {
      const parsed = chatLogSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      await options.dataStore.appendJsonLine('chats.jsonl', {
        ts: getTimestamp(),
        ...parsed.data,
      })

      response.json({ ok: true })
    }),
  )

  return router
}

