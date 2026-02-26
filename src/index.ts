import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cookieParser from 'cookie-parser'

import { KNOWLEDGE_PATH, loadKnowledge } from './lib/knowledge.js'
import { createCorsOriginHandler } from './lib/corsOrigins.js'
import { createDataStore } from './lib/dataStore.js'
import { createApiRouter } from './routes/api.js'
import {
  appBaseUrl,
  corsOrigins,
  dataDir,
  emailPass,
  emailUser,
  isProduction,
  isVercel,
  jwtSecret,
  nodeEnv,
  openAiApiKey,
  openAiClient,
  openAiModel,
  port,
  supabaseAdminClient,
} from './config/runtime.js'

const app = express()
const dataStore = createDataStore({
  dataDir,
  loadKnowledge,
})

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
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
    origin: createCorsOriginHandler(corsOrigins, isProduction),
    credentials: true,
  }),
)

app.use(
  '/api',
  createApiRouter({
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
  }),
)

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
  await dataStore.ensureInitialized()
  const knowledgeText = await dataStore.getKnowledgeText()

  app.listen(port, () => {
    console.log(`[server] listening on http://localhost:${port}`)
    console.log(`[server] env ${nodeEnv}`)
    console.log('[server] OPENAI_API_KEY present:', Boolean(openAiApiKey))
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
