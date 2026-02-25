import cors from 'cors'
import dotenv from 'dotenv'
import express, { type NextFunction, type Request, type Response } from 'express'
import { createHash } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import OpenAI from 'openai'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

import { KNOWLEDGE_PATH, loadKnowledge } from './lib/knowledge.js'
import { sanitizeMessages } from './lib/sanitizeMessages.js'
import { buildSystemPrompt } from './lib/systemPrompt.js'

const serverEnvPath = path.resolve(process.cwd(), '.env')
dotenv.config({ path: serverEnvPath })

const app = express()
const port = Number(process.env.PORT ?? 8787)
const nodeEnv = process.env.NODE_ENV ?? 'development'
const isProduction = nodeEnv === 'production'
const isVercel = process.env.VERCEL === '1'
const configuredDataDir = process.env.DATA_DIR?.trim()
const dataDir = configuredDataDir
  ? path.resolve(configuredDataDir)
  : isVercel
    ? '/tmp/kufu-data'
    : path.resolve(process.cwd(), 'data')
const openAiApiKey = process.env.OPENAI_API_KEY ?? ''
const openAiModel = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
const client = openAiApiKey ? new OpenAI({ apiKey: openAiApiKey }) : null

let knowledgeText = ''
let initPromise: Promise<void> | null = null

const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

function isCorsOriginAllowed(origin: string): boolean {
  return corsOrigins.some((allowedOrigin) => {
    if (allowedOrigin === '*') {
      return true
    }

    if (!allowedOrigin.includes('*')) {
      return allowedOrigin === origin
    }

    const wildcardRegex = new RegExp(
      `^${allowedOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')}$`,
    )

    return wildcardRegex.test(origin)
  })
}

const demoLeadSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Full name is required'),
    businessType: z.string().trim().min(1, 'Business type is required'),
    phone: z.string().trim().min(1, 'Phone is required'),
    email: z.string().trim().email('Valid email is required'),
    message: z.string().trim().optional().default(''),
  })
  .strict()

const contactLeadSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required'),
    lastName: z.string().trim().min(1, 'Last name is required'),
    email: z.string().trim().email('Valid email is required'),
    message: z.string().trim().optional().default(''),
  })
  .strict()

const chatSchema = z
  .object({
    messages: z.unknown(),
    metadata: z
      .object({
        page: z.string().trim().optional(),
      })
      .optional(),
    sessionId: z.string().trim().optional(),
  })
  .strict()

const chatLogSchema = z
  .object({
    sessionId: z.string().trim().min(1, 'sessionId is required'),
    page: z.string().trim().optional(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            content: z.string().trim().min(1, 'Message content is required'),
            createdAt: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1, 'At least one message is required'),
  })
  .strict()

app.use(express.json({ limit: '1mb' }))
app.set('trust proxy', 1)
app.use((req: Request, res: Response, next: NextFunction) => {
  res.on('finish', () => {
    if (req.path.startsWith('/api')) {
      console.log(`[api] ${req.method} ${req.path} -> ${res.statusCode}`)
    }
  })
  next()
})

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true)
        return
      }

      if (isCorsOriginAllowed(origin)) {
        callback(null, true)
        return
      }

      if (!isProduction) {
        console.warn(`[cors] blocked origin ${origin}`)
      }
      callback(null, false)
    },
    credentials: true,
  }),
)
app.use(express.urlencoded({ extended: true }))

function getTimestamp(): number {
  return Date.now()
}

function getClientIp(request: Request): string {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim()
  }

  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0]
  }

  return request.ip || request.socket.remoteAddress || 'unknown'
}

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex')
}

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await mkdir(dataDir, { recursive: true })
      knowledgeText = loadKnowledge()
    })()
  }

  await initPromise
}

async function appendJsonLine(fileName: string, payload: unknown): Promise<void> {
  await ensureInitialized()
  const line = `${JSON.stringify(payload)}\n`
  await appendFile(path.join(dataDir, fileName), line, 'utf8')
}

function respondValidationError(error: z.ZodError, res: Response) {
  return res.status(400).json({
    ok: false,
    error: 'Validation failed',
    issues: error.issues,
  })
}

app.get('/api/health', (_req: Request, res: Response) => {
  return res.json({
    ok: true,
    env: process.env.NODE_ENV || 'development',
    openaiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
  })
})

app.post('/api/leads/demo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = demoLeadSchema.safeParse(req.body)
    if (!parsed.success) {
      return respondValidationError(parsed.error, res)
    }

    await appendJsonLine('leads_demo.jsonl', { ts: getTimestamp(), ...parsed.data })
    return res.json({ ok: true })
  } catch (error) {
    return next(error)
  }
})

app.post('/api/leads/contact', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = contactLeadSchema.safeParse(req.body)
    if (!parsed.success) {
      return respondValidationError(parsed.error, res)
    }

    await appendJsonLine('leads_contact.jsonl', { ts: getTimestamp(), ...parsed.data })
    return res.json({ ok: true })
  } catch (error) {
    return next(error)
  }
})

app.post('/api/chat', async (req: Request, res: Response) => {
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

    await ensureInitialized()

    if (!isProduction) {
      console.log('[/api/chat] sanitized roles:', messages.map((message) => message.role))
    }

    if (!openAiApiKey || !client) {
      return res.json({
        reply: 'OPENAI_API_KEY missing in kufu-backend/.env',
      })
    }

    const system = buildSystemPrompt(knowledgeText)
    const completion = await client.chat.completions.create({
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

    await appendJsonLine('chats_ai.jsonl', {
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

app.post('/api/chat/log', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = chatLogSchema.safeParse(req.body)
    if (!parsed.success) {
      return respondValidationError(parsed.error, res)
    }

    await appendJsonLine('chats.jsonl', { ts: getTimestamp(), ...parsed.data })
    return res.json({ ok: true })
  } catch (error) {
    return next(error)
  }
})

app.use('/api', (_req: Request, res: Response) => {
  return res.status(404).json({
    ok: false,
    error: 'API route not found',
  })
})

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  void _next
  console.error('[express] UNHANDLED ERROR:', err)
  return res.status(500).json({
    ok: false,
    error: 'Unhandled server error',
    details: err instanceof Error ? err.message : String(err),
  })
})

async function start() {
  await ensureInitialized()

  app.listen(port, () => {
    console.log(`[server] listening on http://localhost:${port}`)
    console.log(`[server] env ${nodeEnv}`)
    console.log('[server] OPENAI_API_KEY present:', Boolean(process.env.OPENAI_API_KEY))
    console.log(`[server] knowledge path ${KNOWLEDGE_PATH}`)
    console.log(`[server] knowledge loaded length ${knowledgeText.length}`)
    console.log(`[server] data directory ${dataDir}`)
    console.log(`[server] CORS origins ${corsOrigins.join(', ')}`)
    console.log(`[server] vercel runtime ${isVercel}`)
  })
}

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false

if (isDirectRun) {
  void start().catch((error) => {
    console.error('[server] failed to start', error)
    process.exit(1)
  })
}

export default app
