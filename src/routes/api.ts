import { Router } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'
import type OpenAI from 'openai'

import type { DataStore } from '../lib/dataStore.js'
import { notFoundApiHandler } from '../lib/errorHandler.js'
import { getTimestamp, respondValidationError, sendApiError } from '../lib/http.js'
import { logError } from '../lib/logger.js'
import { createMailer } from '../lib/mailer.js'
import { createFixedWindowLimiter } from '../lib/rateLimit.js'
import { getRequestIdFromRequest } from '../lib/requestContext.js'
import { contactLeadSchema, demoLeadSchema } from '../schemas/api.js'
import { createAdminRouter } from './admin.js'
import { createAuthRouter } from './auth.js'
import { createChatRouter } from './chat.js'
import { createChatbotRouter } from './chatbot.js'
import { createDashboardRouter } from './dashboard.js'
import { createRagRouter } from './rag.js'
import { createWhatsAppRouter } from './whatsapp.js'
import { createWidgetApiRouter } from './widget.js'

type ApiRouterOptions = {
  nodeEnv: string
  isProduction: boolean
  appBaseUrl: string
  backendBaseUrl: string
  frontendUrl: string
  openAiApiKey: string
  openAiModel: string
  whatsappGraphApiVersion: string
  metaAppId: string
  metaAppSecret: string
  metaVerifyToken: string
  metaGraphApiVersion: string
  metaRedirectUri: string
  metaEmbeddedSignupConfigId: string
  openAiClient: OpenAI | null
  supabaseAdminClient: SupabaseClient | null
  jwtSecret: string
  brevoApiKey: string
  contactLeadNotifyEmail: string
  demoLeadNotifyEmail: string
  emailFrom: string
  defaultWidgetLogoPath: string
  defaultWidgetLogoUrl: string
  dataStore: DataStore
  allowDevBypassEmailVerify: boolean
  authRateLimitPerMinute: number
  chatRateLimitPerMinute: number
  leadRateLimitPerMinute: number
  webhookAllowedIps: string[]
  webhookRateLimitPerMinute: number
}

export function createApiRouter(options: ApiRouterOptions): Router {
  const router = Router()
  const leadRoutesLimiter = createFixedWindowLimiter({
    namespace: 'leads',
    windowMs: 60 * 1000,
    max: options.leadRateLimitPerMinute,
    message: 'Too many lead submissions. Please try again in a minute.',
  })

  router.get('/health', (_request, response) => {
    response.json({
      ok: true,
      env: options.nodeEnv,
      openaiKeyPresent: Boolean(options.openAiApiKey),
    })
  })

  if (!options.supabaseAdminClient) {
    router.use((_request, response) => {
      sendApiError(
        response,
        500,
        'Server configuration missing: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
      )
    })
    return router
  }

  const mailer = createMailer({
    brevoApiKey: options.brevoApiKey,
    emailFrom: options.emailFrom,
  })

  router.use(
    '/auth',
    createAuthRouter({
      isProduction: options.isProduction,
      appBaseUrl: options.appBaseUrl,
      backendBaseUrl: options.backendBaseUrl,
      jwtSecret: options.jwtSecret,
      supabaseAdminClient: options.supabaseAdminClient,
      mailer,
      allowDevBypassEmailVerify: options.allowDevBypassEmailVerify,
      authRateLimitPerMinute: options.authRateLimitPerMinute,
    }),
  )

  router.use(
    '/dashboard',
    createDashboardRouter({
      jwtSecret: options.jwtSecret,
      supabaseAdminClient: options.supabaseAdminClient,
      backendBaseUrl: options.backendBaseUrl,
      openAiApiKey: options.openAiApiKey,
      openAiModel: options.openAiModel,
      whatsappGraphApiVersion: options.whatsappGraphApiVersion,
      openAiClient: options.openAiClient,
    }),
  )

  router.use(
    '/whatsapp',
    createWhatsAppRouter({
      supabaseAdminClient: options.supabaseAdminClient,
      openAiApiKey: options.openAiApiKey,
      openAiModel: options.openAiModel,
      openAiClient: options.openAiClient,
      dataStore: options.dataStore,
      whatsappGraphApiVersion: options.whatsappGraphApiVersion,
      jwtSecret: options.jwtSecret,
      backendBaseUrl: options.backendBaseUrl,
      frontendUrl: options.frontendUrl,
      metaAppId: options.metaAppId,
      metaAppSecret: options.metaAppSecret,
      metaVerifyToken: options.metaVerifyToken,
      metaGraphApiVersion: options.metaGraphApiVersion,
      metaRedirectUri: options.metaRedirectUri,
      metaEmbeddedSignupConfigId: options.metaEmbeddedSignupConfigId,
      webhookAllowedIps: options.webhookAllowedIps,
      webhookRateLimitPerMinute: options.webhookRateLimitPerMinute,
    }),
  )

  router.use(
    '/chatbot',
    createChatbotRouter({
      jwtSecret: options.jwtSecret,
      supabaseAdminClient: options.supabaseAdminClient,
    }),
  )

  router.use(
    '/admin',
    createAdminRouter({
      jwtSecret: options.jwtSecret,
      supabaseAdminClient: options.supabaseAdminClient,
    }),
  )

  router.use(
    '/widget',
    createWidgetApiRouter({
      supabaseAdminClient: options.supabaseAdminClient,
      frontendUrl: options.frontendUrl,
      backendBaseUrl: options.backendBaseUrl,
      defaultWidgetLogoPath: options.defaultWidgetLogoPath,
      defaultWidgetLogoUrl: options.defaultWidgetLogoUrl,
    }),
  )

  router.use(
    '/rag',
    createRagRouter({
      jwtSecret: options.jwtSecret,
      supabaseAdminClient: options.supabaseAdminClient,
      openAiClient: options.openAiClient,
    }),
  )

  router.use(
    '/',
    createChatRouter({
      jwtSecret: options.jwtSecret,
      openAiApiKey: options.openAiApiKey,
      openAiModel: options.openAiModel,
      openAiClient: options.openAiClient,
      supabaseAdminClient: options.supabaseAdminClient,
      dataStore: options.dataStore,
      mailer,
      chatRateLimitPerMinute: options.chatRateLimitPerMinute,
    }),
  )

  router.post('/leads/demo', leadRoutesLimiter, async (request, response, next) => {
    try {
      const parsed = demoLeadSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      await options.dataStore.appendJsonLine('leads_demo.jsonl', {
        ts: getTimestamp(),
        ...parsed.data,
      })

      if (mailer) {
        try {
          await mailer.sendDemoLeadNotification({
            to: options.demoLeadNotifyEmail,
            submittedAtIso: new Date().toISOString(),
            fullName: parsed.data.fullName,
            businessType: parsed.data.businessType,
            websiteUrl: parsed.data.websiteUrl,
            phone: parsed.data.phone,
            email: parsed.data.email,
            message: parsed.data.message,
          })
        } catch (mailError) {
          logError({
            type: 'lead_email_send_failed',
            requestId: getRequestIdFromRequest(request),
            path: '/api/leads/demo',
            message: mailError instanceof Error ? mailError.message : 'Unknown lead email error',
          })
        }
      }

      response.json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  router.post('/leads/contact', leadRoutesLimiter, async (request, response, next) => {
    try {
      const parsed = contactLeadSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      await options.dataStore.appendJsonLine('leads_contact.jsonl', {
        ts: getTimestamp(),
        ...parsed.data,
      })

      if (mailer) {
        try {
          await mailer.sendContactLeadNotification({
            to: options.contactLeadNotifyEmail,
            submittedAtIso: new Date().toISOString(),
            firstName: parsed.data.firstName,
            lastName: parsed.data.lastName,
            email: parsed.data.email,
            message: parsed.data.message,
          })
        } catch (mailError) {
          logError({
            type: 'contact_email_send_failed',
            requestId: getRequestIdFromRequest(request),
            path: '/api/leads/contact',
            message: mailError instanceof Error ? mailError.message : 'Unknown contact email error',
          })
        }
      }

      response.json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  router.use(notFoundApiHandler)

  return router
}
