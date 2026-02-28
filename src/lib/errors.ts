import type { NextFunction, Request, Response } from 'express'

export class AppError extends Error {
  readonly statusCode: number
  readonly details?: unknown

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.details = details
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

export function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown> | unknown,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve(handler(request, response, next)).catch(next)
  }
}
