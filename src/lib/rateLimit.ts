import type { NextFunction, Request, Response } from 'express'

export function createInMemoryLimiter(options: {
  windowMs: number
  max: number
  keyGenerator: (request: Request) => string
  message: string
}) {
  const store = new Map<string, { count: number; resetAt: number }>()

  return (request: Request, response: Response, next: NextFunction) => {
    const key = options.keyGenerator(request)
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
      response.status(429).json({
        ok: false,
        error: options.message,
      })
      return
    }

    existing.count += 1
    store.set(key, existing)
    next()
  }
}

export function getRequestIp(request: Request): string {
  const forwarded = request.header('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown'
  }
  return request.ip || request.socket.remoteAddress || 'unknown'
}
