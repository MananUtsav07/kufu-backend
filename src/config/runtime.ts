import dotenv from 'dotenv'
import OpenAI from 'openai'
import path from 'node:path'

import { createSupabaseAdminClient } from '../lib/supabase.js'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

export const port = Number(process.env.PORT ?? 8787)
export const nodeEnv = process.env.NODE_ENV ?? 'development'
export const isProduction = nodeEnv === 'production'

export const frontendUrl =
  process.env.FRONTEND_URL?.trim() || process.env.APP_BASE_URL?.trim() || 'https://kufu-frontend.vercel.app'

export const appBaseUrl = frontendUrl

export const backendBaseUrl =
  process.env.BACKEND_BASE_URL?.trim() ||
  process.env.API_BASE_URL?.trim() ||
  'https://kufu-backend.vercel.app'

const rawAllowedOrigins =
  process.env.ALLOWED_ORIGINS?.trim() ||
  process.env.CORS_ORIGIN?.trim() ||
  `${frontendUrl},http://localhost:5173,http://127.0.0.1:5173`

export const corsOrigins = rawAllowedOrigins
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const configuredDataDir = process.env.DATA_DIR?.trim()
export const dataDir = configuredDataDir
  ? path.resolve(configuredDataDir)
  : path.resolve(process.cwd(), 'data')

export const openAiApiKey = process.env.OPENAI_API_KEY?.trim() ?? ''
export const openAiModel = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
export const openAiClient = openAiApiKey ? new OpenAI({ apiKey: openAiApiKey }) : null

export const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? ''
export const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
export const supabaseAdminClient = createSupabaseAdminClient({
  url: supabaseUrl,
  serviceRoleKey: supabaseServiceRoleKey,
})

export const jwtSecret = process.env.JWT_SECRET?.trim() ?? ''
export const brevoApiKey = process.env.BREVO_API_KEY?.trim() ?? ''
export const emailFrom = process.env.EMAIL_FROM?.trim() ?? ''
export const demoLeadNotifyEmail =
  process.env.DEMO_LEAD_NOTIFY_EMAIL?.trim() || 'kufuchatbot@gmail.com'
export const devBypassEmailVerify = process.env.DEV_BYPASS_EMAIL_VERIFY === 'true'
