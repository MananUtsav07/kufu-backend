import { Router, type NextFunction, type Request, type Response } from 'express'
import type OpenAI from 'openai'

import { demoLeadSchema, contactLeadSchema, chatSchema, chatLogSchema } from '../schemas/api.js'
import { sanitizeMessages } from '../lib/sanitizeMessages.js'
import { buildSystemPrompt } from '../lib/systemPrompt.js'
import { getTimestamp, getClientIp, hashIp, respondValidationError } from '../lib/http.js'
import type { DataStore } from '../lib/dataStore.js'

type ApiRouterOptions = {
  nodeEnv: string
  isProduction: boolean
  openAiApiKey: string
  openAiModel: string
  openAiClient: OpenAI | null
  dataStore: DataStore
}

export function createApiRouter({
  nodeEnv,
  isProduction,
  openAiApiKey,
  openAiModel,
  openAiClient,
  dataStore,
}: ApiRouterOptions): Router {
  const router = Router()

  router.get('/health', (_req: Request, res: Response) => {
    return res.json({
      ok: true,
      env: nodeEnv,
      openaiKeyPresent: Boolean(openAiApiKey),
    })
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

      const messages = sanitizeMessages(req.body?.messages, 12)
      if (messages.length === 0) {
        return res.status(400).json({ reply: 'No valid messages provided.' })
      }

      if (!isProduction) {
        console.log('[/api/chat] sanitized roles:', messages.map((message) => message.role))
      }

      if (!openAiApiKey || !openAiClient) {
        return res.json({
          reply: 'OPENAI_API_KEY missing in kufu-backend/.env',
        })
      }

      const system = buildSystemPrompt(await dataStore.getKnowledgeText())
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
        messages: [...messages, { role: 'assistant' as const, content: reply }],
        model: openAiModel,
      })

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

