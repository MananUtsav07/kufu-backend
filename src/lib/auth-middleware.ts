import type { NextFunction, Request, Response } from 'express'
import type { RequestUser } from '../types/auth.js'
import { verifyAuthToken } from './jwt.js'
import { AppError } from './errors.js'

export type AuthenticatedRequest = Request & {
  user: RequestUser
}

function readBearerToken(request: Request): string | null {
  const header = request.header('authorization')
  if (!header) {
    return null
  }

  const [scheme, token] = header.split(' ')
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    return null
  }

  return token
}

function readCookieToken(request: Request): string | null {
  const candidate = request.cookies?.kufu_session
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : null
}

export function readAuthToken(request: Request): string | null {
  return readBearerToken(request) ?? readCookieToken(request)
}

export function getOptionalRequestUser(request: Request, jwtSecret: string): RequestUser | null {
  const token = readAuthToken(request)
  if (!token || !jwtSecret) {
    return null
  }

  const payload = verifyAuthToken(token, jwtSecret)
  if (!payload) {
    return null
  }

  return {
    userId: payload.sub,
    email: payload.email,
    clientId: payload.client_id,
    role: payload.role,
  }
}

export function authMiddleware(jwtSecret: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!jwtSecret) {
      response.status(500).json({
        ok: false,
        error: 'Server auth configuration missing: JWT_SECRET',
      })
      return
    }

    const requestUser = getOptionalRequestUser(request, jwtSecret)
    if (!requestUser) {
      response.status(401).json({
        ok: false,
        error: 'Unauthorized',
      })
      return
    }

    ;(request as AuthenticatedRequest).user = requestUser
    next()
  }
}

export function requireAdmin(request: Request, _response: Response, next: NextFunction) {
  const authRequest = request as AuthenticatedRequest
  if (!authRequest.user || authRequest.user.role !== 'admin') {
    next(new AppError('Admin access required', 403))
    return
  }

  next()
}
