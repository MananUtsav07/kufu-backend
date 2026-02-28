import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCorsOriginHandler } from './lib/corsOrigins.js'
import { createDataStore } from './lib/dataStore.js'
import { globalErrorHandler } from './lib/errorHandler.js'
import { loadKnowledge, KNOWLEDGE_PATH } from './lib/knowledge.js'
import { requestContextMiddleware } from './lib/requestContext.js'
import { createApiRouter } from './routes/api.js'
import { createWidgetScriptRouter } from './routes/widget.js'
import {
  appBaseUrl,
  backendBaseUrl,
  corsOrigins,
  dataDir,
  devBypassEmailVerify,
  emailPass,
  emailUser,
  frontendUrl,
  isProduction,
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

app.set('trust proxy', 1)
app.use(helmet())
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
app.use(requestContextMiddleware)

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
    backendBaseUrl,
    frontendUrl,
    openAiApiKey,
    openAiModel,
    openAiClient,
    supabaseAdminClient,
    jwtSecret,
    emailUser,
    emailPass,
    dataStore,
    allowDevBypassEmailVerify: devBypassEmailVerify,
  }),
)

if (supabaseAdminClient) {
  app.use(
    '/widget',
    createWidgetScriptRouter({
      supabaseAdminClient,
      frontendUrl,
      backendBaseUrl,
    }),
  )
}

app.use(globalErrorHandler)

async function start() {
  await dataStore.ensureInitialized()
  const knowledgeText = await dataStore.getKnowledgeText()

  app.listen(port, () => {
    console.log(`[server] listening on http://localhost:${port}`)
    console.log(`[server] env ${nodeEnv}`)
    console.log(`[server] OPENAI_API_KEY present: ${Boolean(openAiApiKey)}`)
    console.log(`[server] knowledge path ${KNOWLEDGE_PATH}`)
    console.log(`[server] knowledge loaded length ${knowledgeText.length}`)
    console.log(`[server] data directory ${dataDir}`)
    console.log(`[server] frontend url ${frontendUrl}`)
    console.log(`[server] backend url ${backendBaseUrl}`)
    console.log(`[server] CORS origins ${corsOrigins.join(', ')}`)
  })
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false

if (isDirectRun) {
  void start().catch((error) => {
    console.error('[server] failed to start', error)
    process.exit(1)
  })
}

export default app
