import jwt from 'jsonwebtoken'

export type TenantSessionClaims = {
  sub: string
  owner_id: string
  session_id: string
  role: 'tenant'
  iat?: number
  exp?: number
}

type SignTenantSessionInput = {
  tenantId: string
  ownerId: string
  sessionId: string
}

export function signTenantSessionToken(payload: SignTenantSessionInput, secret: string): string {
  return jwt.sign(
    {
      sub: payload.tenantId,
      owner_id: payload.ownerId,
      session_id: payload.sessionId,
      role: 'tenant',
    },
    secret,
    {
      expiresIn: '7d',
    },
  )
}

export function verifyTenantSessionToken(token: string, secret: string): TenantSessionClaims | null {
  try {
    const decoded = jwt.verify(token, secret)
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      decoded.role !== 'tenant' ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.owner_id !== 'string' ||
      typeof decoded.session_id !== 'string'
    ) {
      return null
    }

    return {
      sub: decoded.sub,
      owner_id: decoded.owner_id,
      session_id: decoded.session_id,
      role: 'tenant',
      iat: typeof decoded.iat === 'number' ? decoded.iat : undefined,
      exp: typeof decoded.exp === 'number' ? decoded.exp : undefined,
    }
  } catch {
    return null
  }
}
