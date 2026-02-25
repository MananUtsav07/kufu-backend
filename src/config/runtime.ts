import dotenv from 'dotenv'
import OpenAI from 'openai'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

export const port = Number(process.env.PORT ?? 8787)
export const nodeEnv = process.env.NODE_ENV ?? 'development'
export const isProduction = nodeEnv === 'production'
export const isVercel = process.env.VERCEL === '1'

const configuredDataDir = process.env.DATA_DIR?.trim()
export const dataDir = configuredDataDir
  ? path.resolve(configuredDataDir)
  : isVercel
    ? '/tmp/kufu-data'
    : path.resolve(process.cwd(), 'data')

export const openAiApiKey = process.env.OPENAI_API_KEY ?? ''
export const openAiModel = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
export const openAiClient = openAiApiKey ? new OpenAI({ apiKey: openAiApiKey }) : null

export const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? ''
export const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
export const jwtSecret = process.env.JWT_SECRET?.trim() ?? ''
export const emailUser = process.env.EMAIL_USER?.trim() ?? ''
export const emailPass = process.env.EMAIL_PASS?.trim() ?? ''
export const appUrl = process.env.APP_URL?.trim() || 'http://localhost:5173'

export const supabaseAdminClient: SupabaseClient | null =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null

export const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
