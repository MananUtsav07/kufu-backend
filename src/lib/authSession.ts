import type { Request, Response } from 'express'
import jwt from 'jsonwebtoken'

const SESSION_COOKIE_NAME = 'kufu_session'
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type SessionPayload = {
  sub: string
  email: string
  iat?: number
  exp?: number
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME
}

export function createSessionToken(payload: { sub: string; email: string }, jwtSecret: string): string {
  return jwt.sign(
    {
      sub: payload.sub,
      email: payload.email,
    },
    jwtSecret,
    {
      expiresIn: '7d',
    },
  )
}

function readBearerToken(request: Request): string | null {
  const header = request.header('authorization')
  if (!header) {
    return null
  }

  const [scheme, token] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null
  }

  return token
}

function readCookieToken(request: Request): string | null {
  const rawValue = request.cookies?.[SESSION_COOKIE_NAME]
  return typeof rawValue === 'string' && rawValue.length > 0 ? rawValue : null
}

function extractToken(request: Request): string | null {
  return readCookieToken(request) ?? readBearerToken(request)
}

export function getUserFromRequest(request: Request, jwtSecret: string): SessionPayload | null {
  const token = extractToken(request)
  if (!token) {
    return null
  }

  try {
    const payload = jwt.verify(token, jwtSecret)
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string'
    ) {
      return null
    }

    return {
      sub: payload.sub,
      email: payload.email,
      iat: typeof payload.iat === 'number' ? payload.iat : undefined,
      exp: typeof payload.exp === 'number' ? payload.exp : undefined,
    }
  } catch {
    return null
  }
}

export function setSessionCookie(response: Response, token: string, isProduction: boolean): void {
  response.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  })
}

export function clearSessionCookie(response: Response, isProduction: boolean): void {
  response.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
  })
}
