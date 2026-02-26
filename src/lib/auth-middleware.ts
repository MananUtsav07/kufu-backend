import type { NextFunction, Request, Response } from 'express'

import { verifyAuthToken } from './jwt.js'

export type RequestUser = {
  userId: string
  email: string
  clientId: string
}

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

function readToken(request: Request): string | null {
  return readBearerToken(request) ?? readCookieToken(request)
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

    const token = readToken(request)
    if (!token) {
      response.status(401).json({
        ok: false,
        error: 'Unauthorized',
      })
      return
    }

    const payload = verifyAuthToken(token, jwtSecret)
    if (!payload) {
      response.status(401).json({
        ok: false,
        error: 'Invalid token',
      })
      return
    }

    ;(request as AuthenticatedRequest).user = {
      userId: payload.sub,
      email: payload.email,
      clientId: payload.client_id,
    }

    next()
  }
}
