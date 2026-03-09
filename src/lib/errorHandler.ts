import type { NextFunction, Request, Response } from 'express'

import { AppError, isAppError } from './errors.js'
import { logError } from './logger.js'
import { getRequestIdFromRequest } from './requestContext.js'

export function notFoundApiHandler(request: Request, response: Response) {
  response.status(404).json({
    ok: false,
    error: `API route not found: ${request.originalUrl}`,
    requestId: getRequestIdFromRequest(request),
  })
}

export function globalErrorHandler(
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction,
) {
  const requestId = getRequestIdFromRequest(request)
  const isProduction = process.env.NODE_ENV === 'production'
  const parseError = error as { type?: string; status?: number; message?: string }

  if (parseError?.type === 'entity.parse.failed' || parseError?.status === 400) {
    logError({
      type: 'invalid_json_payload',
      requestId,
      route: request.path,
      path: request.originalUrl,
      message: parseError.message ?? 'Invalid JSON payload',
    })

    response.status(400).json({
      ok: false,
      error: 'Invalid JSON payload',
      requestId,
    })
    return
  }

  if (isAppError(error)) {
    logError({
      type: 'app_error',
      requestId,
      route: request.path,
      path: request.originalUrl,
      message: error.message,
      statusCode: error.statusCode,
      details: error.details ?? null,
    })

    const safeMessage =
      isProduction && error.statusCode >= 500
        ? 'Internal server error'
        : error.message

    response.status(error.statusCode).json({
      ok: false,
      error: safeMessage,
      requestId,
    })
    return
  }

  const message = error instanceof Error ? error.message : 'Unhandled server error'
  const stack = error instanceof Error ? error.stack : null

  logError({
    type: 'unhandled_error',
    requestId,
    route: request.path,
    path: request.originalUrl,
    message,
    stack,
  })

  response.status(500).json({
    ok: false,
    error: 'Unhandled server error',
    requestId,
  })
}

export function assertConfig(value: unknown, name: string): asserts value {
  if (!value || (typeof value === 'string' && value.trim().length === 0)) {
    throw new AppError(`Missing server configuration: ${name}`, 500)
  }
}
