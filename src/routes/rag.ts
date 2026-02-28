import { Router } from 'express'
import type OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'

import { authMiddleware, type AuthenticatedRequest } from '../lib/auth-middleware.js'
import { asyncHandler, AppError } from '../lib/errors.js'
import { respondValidationError } from '../lib/http.js'
import {
  ragIngestCancelSchema,
  ragIngestResyncSchema,
  ragIngestStartSchema,
  ragIngestStatusQuerySchema,
} from '../schemas/api.js'
import { createRagIngestionManager } from '../rag/ingestionManager.js'
import { getIngestionRunById } from '../rag/store.js'
import { loadChatbotById, loadUserById } from '../services/tenantService.js'

type RagRouterOptions = {
  jwtSecret: string
  supabaseAdminClient: SupabaseClient
  openAiClient: OpenAI | null
}

function getAuthRequest(request: unknown): AuthenticatedRequest {
  return request as AuthenticatedRequest
}

async function ensureChatbotAccess(
  supabaseAdminClient: SupabaseClient,
  args: {
    userId: string
    role: 'user' | 'admin'
    chatbotId: string
  },
) {
  const chatbot = await loadChatbotById(supabaseAdminClient, args.chatbotId)
  if (!chatbot) {
    throw new AppError('Chatbot not found', 404)
  }

  if (args.role !== 'admin' && chatbot.user_id !== args.userId) {
    throw new AppError('Forbidden', 403)
  }

  return chatbot
}

export function createRagRouter(options: RagRouterOptions): Router {
  const router = Router()
  router.use(authMiddleware(options.jwtSecret))

  router.post(
    '/ingest/start',
    asyncHandler(async (request, response) => {
      if (!options.openAiClient) {
        throw new AppError('OpenAI is not configured', 500)
      }

      const parsed = ragIngestStartSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const authRequest = getAuthRequest(request)
      const user = await loadUserById(options.supabaseAdminClient, authRequest.user.userId)
      if (!user) {
        throw new AppError('Unauthorized', 401)
      }

      await ensureChatbotAccess(options.supabaseAdminClient, {
        userId: user.id,
        role: user.role,
        chatbotId: parsed.data.chatbotId,
      })

      const manager = createRagIngestionManager(options.supabaseAdminClient, options.openAiClient)
      const started = await manager.startJob({
        chatbotId: parsed.data.chatbotId,
        websiteUrl: parsed.data.websiteUrl,
        maxPages: parsed.data.maxPages,
        userId: user.id,
        isResync: false,
      })

      response.status(202).json({
        ok: true,
        runId: started.runId,
        status: 'running',
      })
    }),
  )

  router.post(
    '/ingest/resync',
    asyncHandler(async (request, response) => {
      if (!options.openAiClient) {
        throw new AppError('OpenAI is not configured', 500)
      }

      const parsed = ragIngestResyncSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const authRequest = getAuthRequest(request)
      const user = await loadUserById(options.supabaseAdminClient, authRequest.user.userId)
      if (!user) {
        throw new AppError('Unauthorized', 401)
      }

      const chatbot = await ensureChatbotAccess(options.supabaseAdminClient, {
        userId: user.id,
        role: user.role,
        chatbotId: parsed.data.chatbotId,
      })

      const websiteUrl = parsed.data.websiteUrl ?? chatbot.website_url
      if (!websiteUrl) {
        throw new AppError('websiteUrl is required for re-sync when chatbot has no website_url', 400)
      }

      const manager = createRagIngestionManager(options.supabaseAdminClient, options.openAiClient)
      const started = await manager.startJob({
        chatbotId: parsed.data.chatbotId,
        websiteUrl,
        maxPages: parsed.data.maxPages,
        userId: user.id,
        isResync: true,
      })

      response.status(202).json({
        ok: true,
        runId: started.runId,
        status: 'running',
      })
    }),
  )

  router.get(
    '/ingest/status',
    asyncHandler(async (request, response) => {
      const parsed = ragIngestStatusQuerySchema.safeParse({
        runId: request.query.runId,
      })
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const authRequest = getAuthRequest(request)
      const user = await loadUserById(options.supabaseAdminClient, authRequest.user.userId)
      if (!user) {
        throw new AppError('Unauthorized', 401)
      }

      const run = await getIngestionRunById(options.supabaseAdminClient, parsed.data.runId)
      if (!run) {
        throw new AppError('Ingestion run not found', 404)
      }

      await ensureChatbotAccess(options.supabaseAdminClient, {
        userId: user.id,
        role: user.role,
        chatbotId: run.chatbot_id,
      })

      const manager = options.openAiClient
        ? createRagIngestionManager(options.supabaseAdminClient, options.openAiClient)
        : null
      const status = manager ? await manager.getStatus(parsed.data.runId) : null

      response.json({
        ok: true,
        run: status ?? {
          runId: run.id,
          chatbotId: run.chatbot_id,
          status: run.status,
          pagesFound: run.pages_found,
          pagesCrawled: run.pages_crawled,
          chunksWritten: run.chunks_written,
          error: run.error,
          cancelRequested: run.cancel_requested,
          startedAt: run.started_at,
          finishedAt: run.finished_at,
          updatedAt: run.updated_at,
        },
      })
    }),
  )

  router.post(
    '/ingest/cancel',
    asyncHandler(async (request, response) => {
      const parsed = ragIngestCancelSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const authRequest = getAuthRequest(request)
      const user = await loadUserById(options.supabaseAdminClient, authRequest.user.userId)
      if (!user) {
        throw new AppError('Unauthorized', 401)
      }

      const run = await getIngestionRunById(options.supabaseAdminClient, parsed.data.runId)
      if (!run) {
        throw new AppError('Ingestion run not found', 404)
      }

      await ensureChatbotAccess(options.supabaseAdminClient, {
        userId: user.id,
        role: user.role,
        chatbotId: run.chatbot_id,
      })

      if (!options.openAiClient) {
        throw new AppError('OpenAI is not configured', 500)
      }

      const manager = createRagIngestionManager(options.supabaseAdminClient, options.openAiClient)
      await manager.cancel(parsed.data.runId)

      response.json({
        ok: true,
        runId: parsed.data.runId,
        status: 'cancel_requested',
      })
    }),
  )

  return router
}
