import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import type OpenAI from 'openai'

import { globalErrorHandler } from '../../src/lib/errorHandler.js'
import { requestContextMiddleware } from '../../src/lib/requestContext.js'
import { createApiRouter } from '../../src/routes/api.js'
import { createSeededSupabaseClient, type TestSeed } from './inMemorySupabase.js'

type BuildTestAppOptions = {
  openAiMode?: 'disabled' | 'success' | 'throw'
}

type TestAppContext = {
  app: express.Express
  seed: TestSeed
  jwtSecret: string
}

export function buildTestApp(options: BuildTestAppOptions = {}): TestAppContext {
  const { supabase, seed } = createSeededSupabaseClient()
  const app = express()
  const jwtSecret = 'test-jwt-secret'

  const openAiMode = options.openAiMode ?? 'disabled'

  const openAiClient =
    openAiMode === 'disabled'
      ? null
      : ({
          chat: {
            completions: {
              create: async () => {
                if (openAiMode === 'throw') {
                  throw new Error('OpenAI test failure')
                }

                return {
                  choices: [
                    {
                      message: {
                        content: 'Test reply',
                      },
                    },
                  ],
                }
              },
            },
          },
        } as unknown as OpenAI)

  const dataStore = {
    ensureInitialized: async () => undefined,
    appendJsonLine: async () => undefined,
    getKnowledgeText: async () => 'Global test knowledge',
  }

  app.use(
    express.json({
      limit: '1mb',
      verify: (request, _response, buffer) => {
        ;(request as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer)
      },
    }),
  )
  app.use(express.urlencoded({ extended: true }))
  app.use(cookieParser())
  app.use(requestContextMiddleware)
  app.use(cors({ origin: true, credentials: true }))

  app.use(
    '/api',
    createApiRouter({
      nodeEnv: 'test',
      isProduction: false,
      appBaseUrl: 'http://localhost:5173',
      backendBaseUrl: 'http://localhost:8787',
      frontendUrl: 'http://localhost:5173',
      openAiApiKey: openAiMode === 'disabled' ? '' : 'test-openai-key',
      openAiModel: 'gpt-4o-mini',
      whatsappGraphApiVersion: 'v22.0',
      metaAppId: 'meta-app-id',
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'meta-verify-token',
      metaGraphApiVersion: 'v22.0',
      metaRedirectUri: 'http://localhost:5173/dashboard/integrations/whatsapp/connect',
      metaEmbeddedSignupConfigId: 'embedded-config-id',
      openAiClient,
      supabaseAdminClient: supabase as never,
      jwtSecret,
      brevoApiKey: '',
      contactLeadNotifyEmail: 'owner@example.com',
      demoLeadNotifyEmail: 'owner@example.com',
      emailFrom: 'noreply@example.com',
      defaultWidgetLogoPath: '',
      defaultWidgetLogoUrl: '',
      dataStore,
      allowDevBypassEmailVerify: true,
      authRateLimitPerMinute: 1000,
      chatRateLimitPerMinute: 1000,
      leadRateLimitPerMinute: 1000,
      webhookAllowedIps: [],
      webhookRateLimitPerMinute: 1000,
    }),
  )

  app.use(globalErrorHandler)

  return {
    app,
    seed,
    jwtSecret,
  }
}
