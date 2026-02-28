import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

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
    const logPayload = {
      level: 'info',
      type: 'request',
      requestId,
      method: request.method,
      path: request.originalUrl,
      statusCode: response.statusCode,
      durationMs,
      ip: getClientAddress(request),
    }

    console.log(JSON.stringify(logPayload))
  })

  next()
}
