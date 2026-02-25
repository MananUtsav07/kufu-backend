import dotenv from 'dotenv'
import OpenAI from 'openai'
import path from 'node:path'

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

export const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
