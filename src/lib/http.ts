import { createHash } from 'node:crypto'
import type { Request, Response } from 'express'
import { z } from 'zod'

export function getTimestamp(): number {
  return Date.now()
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim()
  }

  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0]
  }

  return request.ip || request.socket.remoteAddress || 'unknown'
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex')
}

export function respondValidationError(error: z.ZodError, response: Response) {
  return response.status(400).json({
    ok: false,
    error: 'Validation failed',
    issues: error.issues,
  })
}
