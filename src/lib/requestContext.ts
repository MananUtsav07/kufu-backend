import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

import type { AuthenticatedRequest } from './auth-middleware.js'
import { logInfo } from './logger.js'

export type RequestWithContext = Request & {
  requestId?: string
}

function getClientAddress(request: Request): string {
  const forwarded = request.header('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown'
  }
  return request.ip || request.socket.remoteAddress || 'unknown'
}

export function getRequestIdFromRequest(request: Request): string {
  return (request as RequestWithContext).requestId || 'unknown'
}

export function getRequestIdFromResponse(response: Response): string {
  const requestIdHeader = response.getHeader('x-request-id')
  return typeof requestIdHeader === 'string' ? requestIdHeader : 'unknown'
}

export function requestContextMiddleware(request: Request, response: Response, next: NextFunction) {
  const requestId = request.header('x-request-id')?.trim() || randomUUID()
  ;(request as RequestWithContext).requestId = requestId
  response.setHeader('x-request-id', requestId)

  const startedAt = Date.now()
  response.on('finish', () => {
    if (!request.path.startsWith('/api') && !request.path.startsWith('/widget')) {
      return
    }

    const durationMs = Date.now() - startedAt
    const requestUser = request as Partial<AuthenticatedRequest>
    const userId = typeof requestUser.user?.userId === 'string' ? requestUser.user.userId : null

    logInfo({
      type: 'request',
      requestId,
      method: request.method,
      route: request.path,
      path: request.originalUrl,
      userId,
      statusCode: response.statusCode,
      durationMs,
      ip: getClientAddress(request),
    })
  })

  next()
}
