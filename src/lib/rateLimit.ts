import type { NextFunction, Request, Response } from 'express'

import { getClientIp, sendApiError } from './http.js'

type RateLimiterOptions = {
  windowMs: number
  max: number
  message: string
  keyGenerator?: (request: Request) => string
}

export function createInMemoryLimiter(options: RateLimiterOptions) {
  const store = new Map<string, { count: number; resetAt: number }>()

  return (request: Request, response: Response, next: NextFunction) => {
    const key = options.keyGenerator?.(request) ?? getClientIp(request)
    const now = Date.now()
    const existing = store.get(key)

    if (!existing || existing.resetAt <= now) {
      store.set(key, {
        count: 1,
        resetAt: now + options.windowMs,
      })
      next()
      return
    }

    if (existing.count >= options.max) {
      sendApiError(response, 429, options.message)
      return
    }

    existing.count += 1
    store.set(key, existing)
    next()
  }
}

export function createFixedWindowLimiter(options: {
  namespace: string
  windowMs: number
  max: number
  message: string
  keyGenerator?: (request: Request) => string
}) {
  const keyPrefix = options.namespace.trim() || 'ratelimit'

  return createInMemoryLimiter({
    windowMs: options.windowMs,
    max: options.max,
    message: options.message,
    keyGenerator: (request) => {
      const key = options.keyGenerator?.(request) ?? getClientIp(request)
      return `${keyPrefix}:${key}`
    },
  })
}

export function getRequestIp(request: Request): string {
  return getClientIp(request)
}
