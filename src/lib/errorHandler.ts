import type { NextFunction, Request, Response } from 'express'
import { AppError, isAppError } from './errors.js'
import type { RequestWithContext } from './requestContext.js'

export function notFoundApiHandler(request: Request, response: Response) {
  response.status(404).json({
    ok: false,
    error: `API route not found: ${request.originalUrl}`,
  })
}

export function globalErrorHandler(
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction,
) {
  const requestId = (request as RequestWithContext).requestId

  if (isAppError(error)) {
    console.error(
      JSON.stringify({
        level: 'error',
        type: 'app_error',
        requestId,
        path: request.originalUrl,
        message: error.message,
        statusCode: error.statusCode,
        details: error.details,
      }),
    )

    response.status(error.statusCode).json({
      ok: false,
      error: error.message,
      details: error.details ?? null,
      requestId,
    })
    return
  }

  const message = error instanceof Error ? error.message : 'Unhandled server error'
  const stack = error instanceof Error ? error.stack : null

  console.error(
    JSON.stringify({
      level: 'error',
      type: 'unhandled_error',
      requestId,
      path: request.originalUrl,
      message,
      stack,
    }),
  )

  response.status(500).json({
    ok: false,
    error: 'Unhandled server error',
    details: message,
    requestId,
  })
}

export function assertConfig(value: unknown, name: string): asserts value {
  if (!value || (typeof value === 'string' && value.trim().length === 0)) {
    throw new AppError(`Missing server configuration: ${name}`, 500)
  }
}
