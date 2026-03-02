import { Router } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'

import { authMiddleware, type AuthenticatedRequest } from '../lib/auth-middleware.js'
import { asyncHandler, AppError } from '../lib/errors.js'
import { respondValidationError } from '../lib/http.js'
import { chatbotSettingsUpdateSchema } from '../schemas/chatbot.js'
import {
  buildDefaultSettings,
  getChatbotSettings,
  upsertChatbotSettings,
} from '../services/chatbotSettingsService.js'
import { loadChatbotById } from '../services/tenantService.js'

type ChatbotRouterOptions = {
  jwtSecret: string
  supabaseAdminClient: SupabaseClient
}

function asAuthenticatedRequest(request: unknown): AuthenticatedRequest {
  return request as AuthenticatedRequest
}

function toSingleParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim().length > 0) {
    return value[0]
  }
  return null
}

async function loadOwnedChatbot(args: {
  supabaseAdminClient: SupabaseClient
  chatbotId: string
  userId: string
  role: 'user' | 'admin'
}) {
  const chatbot = await loadChatbotById(args.supabaseAdminClient, args.chatbotId)
  const isOwner = chatbot?.user_id === args.userId
  const canManage = args.role === 'admin' || isOwner

  if (!chatbot || !canManage) {
    throw new AppError('Chatbot not found', 404)
  }

  return chatbot
}

export function createChatbotRouter(options: ChatbotRouterOptions): Router {
  const router = Router()

  router.use(authMiddleware(options.jwtSecret))

  router.get(
    '/settings/:chatbotId',
    asyncHandler(async (request, response) => {
      const chatbotId = toSingleParam(request.params.chatbotId)
      if (!chatbotId) {
        throw new AppError('chatbotId is required', 400)
      }

      const authRequest = asAuthenticatedRequest(request)
      const chatbot = await loadOwnedChatbot({
        supabaseAdminClient: options.supabaseAdminClient,
        chatbotId,
        userId: authRequest.user.userId,
        role: authRequest.user.role,
      })

      const settings = await getChatbotSettings({
        supabaseAdminClient: options.supabaseAdminClient,
        chatbot,
      })

      if (!settings) {
        return response.json({
          ok: true,
          settings: buildDefaultSettings(chatbot),
        })
      }

      response.json({ ok: true, settings })
    }),
  )

  router.put(
    '/settings/:chatbotId',
    asyncHandler(async (request, response) => {
      const chatbotId = toSingleParam(request.params.chatbotId)
      if (!chatbotId) {
        throw new AppError('chatbotId is required', 400)
      }

      const parsed = chatbotSettingsUpdateSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const authRequest = asAuthenticatedRequest(request)
      const chatbot = await loadOwnedChatbot({
        supabaseAdminClient: options.supabaseAdminClient,
        chatbotId,
        userId: authRequest.user.userId,
        role: authRequest.user.role,
      })

      const settings = await upsertChatbotSettings({
        supabaseAdminClient: options.supabaseAdminClient,
        chatbot,
        botName: parsed.data.bot_name,
        greetingMessage: parsed.data.greeting_message,
        primaryColor: parsed.data.primary_color,
      })

      response.json({ ok: true, settings })
    }),
  )

  return router
}
