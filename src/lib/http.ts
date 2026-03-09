import { createHash } from 'node:crypto'
import type { Request, Response } from 'express'
import { z } from 'zod'

import { getRequestIdFromResponse } from './requestContext.js'

type ApiErrorPayload = {
  ok: false
  error: string
  requestId: string
}

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

export function buildApiErrorPayload(response: Response, message: string): ApiErrorPayload {
  return {
    ok: false,
    error: message,
    requestId: getRequestIdFromResponse(response),
  }
}

export function sendApiError(response: Response, statusCode: number, message: string): Response {
  return response.status(statusCode).json(buildApiErrorPayload(response, message))
}

export function respondValidationError(error: z.ZodError, response: Response): Response {
  const message = error.issues[0]?.message || 'Validation failed'
  return sendApiError(response, 400, message)
}
