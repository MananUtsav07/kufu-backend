import dotenv from 'dotenv'
import OpenAI from 'openai'
import path from 'node:path'

import { createSupabaseAdminClient } from '../lib/supabase.js'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

export const port = Number(process.env.PORT ?? 8787)
export const nodeEnv = process.env.NODE_ENV ?? 'development'
export const isProduction = nodeEnv === 'production'

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }

    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return null
  }
}

function resolveUrl(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }
    const normalized = normalizeOrigin(candidate)
    if (normalized) {
      return normalized
    }
  }

  return ''
}

function parseAllowedOrigins(rawValue: string): string[] {
  const deduped = new Set<string>()
  for (const entry of rawValue.split(',')) {
    const normalized = normalizeOrigin(entry)
    if (normalized) {
      deduped.add(normalized)
    }
  }
  return Array.from(deduped)
}

function parsePositiveInteger(
  rawValue: string | undefined,
  fallbackValue: number,
): number {
  if (!rawValue) {
    return fallbackValue
  }

  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue
  }

  return parsed
}

function parseOptionalIpList(rawValue: string | undefined): string[] {
  if (!rawValue) {
    return []
  }

  const deduped = new Set<string>()
  for (const entry of rawValue.split(',')) {
    const trimmed = entry.trim()
    if (trimmed.length > 0) {
      deduped.add(trimmed)
    }
  }

  return Array.from(deduped)
}

const localFrontendOrigin = 'http://localhost:5173'
const localFrontendLoopbackOrigin = 'http://127.0.0.1:5173'
const localBackendOrigin = 'http://localhost:8787'

export const frontendUrl = resolveUrl(
  process.env.FRONTEND_URL,
  process.env.APP_BASE_URL,
  isProduction ? undefined : localFrontendOrigin,
)

export const appBaseUrl = frontendUrl

export const backendBaseUrl = resolveUrl(
  process.env.BACKEND_BASE_URL,
  process.env.API_BASE_URL,
  isProduction ? undefined : localBackendOrigin,
)

const rawAllowedOrigins = process.env.ALLOWED_ORIGINS?.trim() || process.env.CORS_ORIGIN?.trim() || ''
export const corsOrigins = parseAllowedOrigins(
  rawAllowedOrigins ||
    (isProduction
      ? frontendUrl
      : [frontendUrl, localFrontendOrigin, localFrontendLoopbackOrigin].filter(Boolean).join(',')),
)

const configuredDataDir = process.env.DATA_DIR?.trim()
export const dataDir = configuredDataDir
  ? path.resolve(configuredDataDir)
  : path.resolve(process.cwd(), 'data')

export const openAiApiKey = process.env.OPENAI_API_KEY?.trim() ?? ''
export const openAiModel = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
export const openAiClient = openAiApiKey ? new OpenAI({ apiKey: openAiApiKey }) : null
export const whatsappGraphApiVersion = process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || 'v22.0'
export const metaAppId = process.env.META_APP_ID?.trim() ?? ''
export const metaAppSecret = process.env.META_APP_SECRET?.trim() ?? ''
export const metaVerifyToken = process.env.META_VERIFY_TOKEN?.trim() ?? ''
export const metaGraphApiVersion =
  process.env.META_GRAPH_API_VERSION?.trim() || whatsappGraphApiVersion
export const metaRedirectUri = process.env.META_REDIRECT_URI?.trim() ?? ''
export const metaEmbeddedSignupConfigId =
  process.env.META_EMBEDDED_SIGNUP_CONFIG_ID?.trim() ?? ''
export const webhookAllowedIps = parseOptionalIpList(
  process.env.WHATSAPP_WEBHOOK_ALLOWED_IPS,
)

export const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? ''
export const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
export const supabaseAdminClient = createSupabaseAdminClient({
  url: supabaseUrl,
  serviceRoleKey: supabaseServiceRoleKey,
})

export const defaultWidgetLogoPath = process.env.DEFAULT_WIDGET_LOGO_PATH?.trim() ?? ''
export const defaultWidgetLogoUrl = process.env.DEFAULT_WIDGET_LOGO_URL?.trim() ?? ''

export const jwtSecret = process.env.JWT_SECRET?.trim() ?? ''
export const brevoApiKey = process.env.BREVO_API_KEY?.trim() ?? ''
export const emailFrom = process.env.EMAIL_FROM?.trim() ?? ''
export const demoLeadNotifyEmail =
  process.env.DEMO_LEAD_NOTIFY_EMAIL?.trim() || 'kufuchatbot@gmail.com'
export const contactLeadNotifyEmail =
  process.env.CONTACT_LEAD_NOTIFY_EMAIL?.trim() || demoLeadNotifyEmail
export const devBypassEmailVerify = process.env.DEV_BYPASS_EMAIL_VERIFY === 'true'
export const authRateLimitPerMinute = parsePositiveInteger(
  process.env.RATE_LIMIT_AUTH_PER_MINUTE,
  10,
)
export const chatRateLimitPerMinute = parsePositiveInteger(
  process.env.RATE_LIMIT_CHAT_PER_MINUTE,
  60,
)
export const leadRateLimitPerMinute = parsePositiveInteger(
  process.env.RATE_LIMIT_LEADS_PER_MINUTE,
  20,
)
export const webhookRateLimitPerMinute = parsePositiveInteger(
  process.env.RATE_LIMIT_WEBHOOKS_PER_MINUTE,
  120,
)

const productionRequirements: Array<{ name: string; value: string }> = [
  { name: 'FRONTEND_URL', value: frontendUrl },
  { name: 'BACKEND_BASE_URL', value: backendBaseUrl },
  { name: 'SUPABASE_URL', value: supabaseUrl },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', value: supabaseServiceRoleKey },
  { name: 'JWT_SECRET', value: jwtSecret },
  { name: 'BREVO_API_KEY', value: brevoApiKey },
  { name: 'EMAIL_FROM', value: emailFrom },
]

if (isProduction) {
  if (rawAllowedOrigins.includes('*')) {
    throw new Error('ALLOWED_ORIGINS must use explicit origins only in production.')
  }

  const missingVariables = productionRequirements
    .filter((entry) => !entry.value)
    .map((entry) => entry.name)

  if (corsOrigins.length === 0) {
    missingVariables.push('ALLOWED_ORIGINS')
  }

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing required production environment variables: ${Array.from(new Set(missingVariables)).join(', ')}`,
    )
  }
}
