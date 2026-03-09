import type { CorsOptions } from 'cors'
import { logWarn } from './logger.js'

function normalizeOrigin(origin: string): string | null {
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }

    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return null
  }
}

export function createCorsOriginHandler(
  allowedOrigins: string[],
  isProduction: boolean,
): CorsOptions['origin'] {
  const allowedOriginSet = new Set(
    allowedOrigins.map((origin) => normalizeOrigin(origin)).filter((origin): origin is string => Boolean(origin)),
  )

  return (origin, callback) => {
    if (!origin) {
      callback(null, true)
      return
    }

    const normalizedOrigin = normalizeOrigin(origin)
    if (normalizedOrigin && allowedOriginSet.has(normalizedOrigin)) {
      callback(null, true)
      return
    }

    if (!isProduction) {
      logWarn({
        type: 'cors_blocked_origin',
        origin,
      })
    }

    callback(null, false)
  }
}
