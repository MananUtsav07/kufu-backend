import jwt from 'jsonwebtoken'

export type AppJwtPayload = {
  sub: string
  email: string
  client_id: string
  iat?: number
  exp?: number
}

type SignTokenInput = {
  userId: string
  email: string
  clientId: string
}

export function signAuthToken(payload: SignTokenInput, secret: string): string {
  return jwt.sign(
    {
      sub: payload.userId,
      email: payload.email,
      client_id: payload.clientId,
    },
    secret,
    {
      expiresIn: '7d',
    },
  )
}

export function verifyAuthToken(token: string, secret: string): AppJwtPayload | null {
  try {
    const decoded = jwt.verify(token, secret)
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.email !== 'string' ||
      typeof decoded.client_id !== 'string'
    ) {
      return null
    }

    return {
      sub: decoded.sub,
      email: decoded.email,
      client_id: decoded.client_id,
      iat: typeof decoded.iat === 'number' ? decoded.iat : undefined,
      exp: typeof decoded.exp === 'number' ? decoded.exp : undefined,
    }
  } catch {
    return null
  }
}
