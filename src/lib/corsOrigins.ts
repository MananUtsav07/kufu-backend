import type { CorsOptions } from 'cors'

export function isCorsOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.some((allowedOrigin) => {
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

export function createCorsOriginHandler(
  allowedOrigins: string[],
  isProduction: boolean,
): CorsOptions['origin'] {
  return (origin, callback) => {
    if (!origin) {
      callback(null, true)
      return
    }

    if (isCorsOriginAllowed(origin, allowedOrigins)) {
      callback(null, true)
      return
    }

    if (!isProduction) {
      console.warn(`[cors] blocked origin ${origin}`)
    }

    callback(null, false)
  }
}

