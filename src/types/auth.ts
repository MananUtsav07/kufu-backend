export type UserRole = 'user' | 'admin'

export type RequestUser = {
  userId: string
  email: string
  clientId: string
  role: UserRole
}

export type JwtPayload = {
  sub: string
  email: string
  client_id: string
  role: UserRole
  iat?: number
  exp?: number
}
