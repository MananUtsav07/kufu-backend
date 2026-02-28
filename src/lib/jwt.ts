import jwt from 'jsonwebtoken'
import type { JwtPayload, UserRole } from '../types/auth.js'

type SignTokenInput = {
  userId: string
  email: string
  clientId: string
  role: UserRole
}

export function signAuthToken(payload: SignTokenInput, secret: string): string {
  return jwt.sign(
    {
      sub: payload.userId,
      email: payload.email,
      client_id: payload.clientId,
      role: payload.role,
    },
    secret,
    {
      expiresIn: '7d',
    },
  )
}

export function verifyAuthToken(token: string, secret: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, secret)
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.email !== 'string' ||
      typeof decoded.client_id !== 'string' ||
      (decoded.role !== 'user' && decoded.role !== 'admin')
    ) {
      return null
    }

    return {
      sub: decoded.sub,
      email: decoded.email,
      client_id: decoded.client_id,
      role: decoded.role,
      iat: typeof decoded.iat === 'number' ? decoded.iat : undefined,
      exp: typeof decoded.exp === 'number' ? decoded.exp : undefined,
    }
  } catch {
    return null
  }
}
