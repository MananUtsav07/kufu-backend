import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { Router, type NextFunction, type Request, type Response } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'

import { authMiddleware, type AuthenticatedRequest } from '../lib/auth-middleware.js'
import { getClientIp, respondValidationError } from '../lib/http.js'
import { signAuthToken } from '../lib/jwt.js'
import type { createMailer } from '../lib/mailer.js'
import { normalizeEmail } from '../lib/validation.js'
import { loginSchema, registerSchema, verifyEmailSchema, verifyQuerySchema } from '../schemas/auth.js'

type Mailer = ReturnType<typeof createMailer>

type AuthRouterOptions = {
  isProduction: boolean
  appBaseUrl: string
  jwtSecret: string
  supabaseAdminClient: SupabaseClient | null
  mailer: Mailer
}

type UserRow = {
  id: string
  email: string
  password_hash: string
  is_verified: boolean
}

type ClientRow = {
  id: string
  user_id: string
  business_name: string
  website_url: string | null
  plan: string
}

type VerificationTokenRow = {
  id: string
  user_id: string
  token: string
  expires_at: string
}

type RegisterUserRow = {
  id: string
  email: string
  is_verified: boolean
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function asQueryParam(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0]
  }

  return undefined
}

function isTokenExpired(expiresAtIso: string): boolean {
  const expiresAt = new Date(expiresAtIso).getTime()
  return Number.isNaN(expiresAt) || expiresAt < Date.now()
}

function createAuthRateLimiter({
  windowMs,
  maxRequests,
}: {
  windowMs: number
  maxRequests: number
}) {
  const store = new Map<string, { count: number; resetAt: number }>()

  return (request: Request, response: Response, next: NextFunction) => {
    const ip = getClientIp(request)
    const routeKey = `${request.method}:${request.path}`
    const key = `${routeKey}:${ip}`
    const now = Date.now()
    const current = store.get(key)

    if (!current || current.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs })
      next()
      return
    }

    if (current.count >= maxRequests) {
      response.status(429).json({
        ok: false,
        error: 'Too many auth requests. Please try again later.',
      })
      return
    }

    current.count += 1
    store.set(key, current)
    next()
  }
}

function sendVerifyResponse(
  response: Response,
  status: number,
  payload: { ok: boolean; message: string; appBaseUrl: string },
) {
  const acceptsJson = (response.req.headers.accept ?? '').includes('application/json')

  if (acceptsJson) {
    if (payload.ok) {
      response.status(status).json({ ok: true, message: payload.message })
    } else {
      response.status(status).json({ ok: false, error: payload.message })
    }
    return
  }

  const loginUrl = `${trimTrailingSlash(payload.appBaseUrl)}/login`
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Email Verification</title>
    ${payload.ok ? `<meta http-equiv="refresh" content="2;url=${loginUrl}" />` : ''}
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101222;color:#e2e8f0;font-family:Inter,Arial,sans-serif;padding:24px}
      .card{width:min(520px,100%);background:#0f172a;border:1px solid #334155;border-radius:16px;padding:24px}
      h1{margin:0 0 12px;font-size:24px}
      p{margin:0 0 16px;line-height:1.5;color:#cbd5e1}
      a{color:#60a5fa;text-decoration:none}
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${payload.ok ? 'Email verified' : 'Verification failed'}</h1>
      <p>${payload.message}</p>
      <a href="${loginUrl}">Go to login</a>
      ${payload.ok ? '<p>Redirecting in 2 seconds...</p>' : ''}
    </div>
  </body>
</html>`

  response.status(status).type('html').send(html)
}

function ensureAuthDependencies(
  response: Response,
  options: {
    supabaseAdminClient: SupabaseClient | null
    jwtSecret: string
    mailer: Mailer
  },
): options is {
  supabaseAdminClient: SupabaseClient
  jwtSecret: string
  mailer: NonNullable<Mailer>
} {
  const missing: string[] = []
  if (!options.supabaseAdminClient) {
    missing.push('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY')
  }
  if (!options.jwtSecret) {
    missing.push('JWT_SECRET')
  }
  if (!options.mailer) {
    missing.push('EMAIL_USER/EMAIL_PASS')
  }

  if (missing.length > 0) {
    response.status(500).json({
      ok: false,
      error: `Server auth configuration missing: ${missing.join(', ')}`,
    })
    return false
  }

  return true
}

async function fetchClientForUser(supabase: SupabaseClient, userId: string): Promise<ClientRow | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, user_id, business_name, website_url, plan')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<ClientRow>()

  if (error) {
    throw new Error(`client_lookup_failed:${error.message}`)
  }

  return data ?? null
}

export function createAuthRouter({
  isProduction,
  appBaseUrl,
  jwtSecret,
  supabaseAdminClient,
  mailer,
}: AuthRouterOptions): Router {
  const router = Router()
  const authLimiter = createAuthRateLimiter({
    windowMs: 10 * 60 * 1000,
    maxRequests: 30,
  })

  router.use(authLimiter)

  router.post('/register', async (request: Request, response: Response) => {
    const parsed = registerSchema.safeParse(request.body)
    if (!parsed.success) {
      return respondValidationError(parsed.error, response)
    }

    if (!ensureAuthDependencies(response, { supabaseAdminClient, jwtSecret, mailer })) {
      return
    }

    const supabase = supabaseAdminClient as SupabaseClient
    const authMailer = mailer as NonNullable<Mailer>
    const email = normalizeEmail(parsed.data.email)
    const passwordHash = await bcrypt.hash(parsed.data.password, 12)
    const requestedBusinessName = parsed.data.business_name?.trim() || 'Kufu Client'
    const requestedWebsiteUrl = parsed.data.website_url?.trim() || null

    try {
      const { data: existingUser, error: existingUserError } = await supabase
        .from('users')
        .select('id, email, is_verified')
        .eq('email', email)
        .maybeSingle<RegisterUserRow>()

      if (existingUserError) {
        console.error('[auth/register] existing user lookup failed:', existingUserError)
        return response.status(500).json({ ok: false, error: 'Failed to query user' })
      }

      if (existingUser?.is_verified) {
        return response.status(409).json({ ok: false, error: 'Email already registered' })
      }

      let userId = existingUser?.id
      if (!userId) {
        const { data: createdUser, error: createUserError } = await supabase
          .from('users')
          .insert({
            email,
            password_hash: passwordHash,
            is_verified: false,
          })
          .select('id')
          .single<{ id: string }>()

        if (createUserError || !createdUser) {
          console.error('[auth/register] create user failed:', createUserError)
          return response.status(500).json({ ok: false, error: 'Failed to create user' })
        }

        userId = createdUser.id
      } else {
        const { error: updateUserError } = await supabase
          .from('users')
          .update({
            password_hash: passwordHash,
            is_verified: false,
          })
          .eq('id', userId)

        if (updateUserError) {
          console.error('[auth/register] update user failed:', updateUserError)
          return response.status(500).json({ ok: false, error: 'Failed to update user' })
        }
      }

      const existingClient = await fetchClientForUser(supabase, userId)
      if (!existingClient) {
        const { error: createClientError } = await supabase.from('clients').insert({
          user_id: userId,
          business_name: requestedBusinessName,
          website_url: requestedWebsiteUrl,
          plan: 'starter',
        })

        if (createClientError) {
          console.error('[auth/register] create client failed:', createClientError)
          return response.status(500).json({ ok: false, error: 'Failed to create client' })
        }
      } else if (requestedBusinessName || requestedWebsiteUrl) {
        const { error: updateClientError } = await supabase
          .from('clients')
          .update({
            business_name: requestedBusinessName || existingClient.business_name,
            website_url: requestedWebsiteUrl ?? existingClient.website_url,
          })
          .eq('id', existingClient.id)

        if (updateClientError) {
          console.error('[auth/register] update client failed:', updateClientError)
          return response.status(500).json({ ok: false, error: 'Failed to update client' })
        }
      }

      const token = randomBytes(24).toString('hex')
      const expiresInMinutes = 10
      const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString()

      const { error: removeOldTokensError } = await supabase
        .from('email_verification_tokens')
        .delete()
        .eq('user_id', userId)

      if (removeOldTokensError) {
        console.error('[auth/register] delete old tokens failed:', removeOldTokensError)
        return response.status(500).json({ ok: false, error: 'Failed to rotate verification token' })
      }

      const { error: insertTokenError } = await supabase.from('email_verification_tokens').insert({
        user_id: userId,
        email,
        token,
        expires_at: expiresAt,
      })

      if (insertTokenError) {
        console.error('[auth/register] insert token failed:', insertTokenError)
        return response.status(500).json({ ok: false, error: 'Failed to create verification token' })
      }

      const base = trimTrailingSlash(appBaseUrl)
      const query = new URLSearchParams({ token }).toString()
      const verificationUrl = `${base}/verify?${query}`
      const fallbackVerificationUrl = `${base}/api/auth/verify?${query}`

      await authMailer.sendVerificationEmail({
        to: email,
        verificationUrl,
        fallbackVerificationUrl,
        expiresInMinutes,
      })

      return response.status(201).json({ ok: true })
    } catch (error) {
      console.error('[auth/register] unexpected error:', error)
      return response.status(500).json({ ok: false, error: 'Server error while registering user' })
    }
  })

  router.post('/verify-email', async (request: Request, response: Response) => {
    const parsed = verifyEmailSchema.safeParse(request.body)
    if (!parsed.success) {
      return respondValidationError(parsed.error, response)
    }

    if (!supabaseAdminClient) {
      return response.status(500).json({
        ok: false,
        error: 'Server auth configuration missing: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY',
      })
    }

    try {
      const { data: tokenRow, error: tokenLookupError } = await supabaseAdminClient
        .from('email_verification_tokens')
        .select('id, user_id, token, expires_at')
        .eq('token', parsed.data.token)
        .maybeSingle<VerificationTokenRow>()

      if (tokenLookupError) {
        console.error('[auth/verify-email] token lookup failed:', tokenLookupError)
        return response.status(500).json({ ok: false, error: 'Failed to verify token' })
      }

      if (!tokenRow) {
        return response.status(400).json({ ok: false, error: 'Invalid verification token' })
      }

      if (isTokenExpired(tokenRow.expires_at)) {
        await supabaseAdminClient.from('email_verification_tokens').delete().eq('id', tokenRow.id)
        return response.status(400).json({ ok: false, error: 'Verification token expired' })
      }

      const { error: verifyUserError } = await supabaseAdminClient
        .from('users')
        .update({
          is_verified: true,
        })
        .eq('id', tokenRow.user_id)

      if (verifyUserError) {
        console.error('[auth/verify-email] verify user failed:', verifyUserError)
        return response.status(500).json({ ok: false, error: 'Failed to verify user' })
      }

      const { error: deleteTokenError } = await supabaseAdminClient
        .from('email_verification_tokens')
        .delete()
        .eq('id', tokenRow.id)

      if (deleteTokenError) {
        console.error('[auth/verify-email] delete token failed:', deleteTokenError)
        return response.status(500).json({ ok: false, error: 'Failed to clean verification token' })
      }

      return response.json({ ok: true })
    } catch (error) {
      console.error('[auth/verify-email] unexpected error:', error)
      return response.status(500).json({ ok: false, error: 'Server error while verifying email' })
    }
  })

  router.get('/verify', async (request: Request, response: Response) => {
    const token = asQueryParam(request.query.token)
    const email = asQueryParam(request.query.email)
    const parsed = verifyQuerySchema.safeParse({ token, email })
    if (!parsed.success) {
      return sendVerifyResponse(response, 400, {
        ok: false,
        message: 'Invalid verification link.',
        appBaseUrl,
      })
    }

    const parsedBody = verifyEmailSchema.safeParse({
      token: parsed.data.token,
    })
    if (!parsedBody.success) {
      return sendVerifyResponse(response, 400, {
        ok: false,
        message: 'Invalid verification token.',
        appBaseUrl,
      })
    }

    if (!supabaseAdminClient) {
      return sendVerifyResponse(response, 500, {
        ok: false,
        message: 'Server configuration missing.',
        appBaseUrl,
      })
    }

    try {
      const { data: tokenRow, error: tokenLookupError } = await supabaseAdminClient
        .from('email_verification_tokens')
        .select('id, user_id, token, expires_at')
        .eq('token', parsedBody.data.token)
        .maybeSingle<VerificationTokenRow>()

      if (tokenLookupError) {
        console.error('[auth/verify] token lookup failed:', tokenLookupError)
        return sendVerifyResponse(response, 500, {
          ok: false,
          message: 'Unable to verify token right now.',
          appBaseUrl,
        })
      }

      if (!tokenRow) {
        return sendVerifyResponse(response, 400, {
          ok: false,
          message: 'Invalid verification token.',
          appBaseUrl,
        })
      }

      if (isTokenExpired(tokenRow.expires_at)) {
        await supabaseAdminClient.from('email_verification_tokens').delete().eq('id', tokenRow.id)
        return sendVerifyResponse(response, 400, {
          ok: false,
          message: 'Verification token expired.',
          appBaseUrl,
        })
      }

      const { error: verifyUserError } = await supabaseAdminClient
        .from('users')
        .update({ is_verified: true })
        .eq('id', tokenRow.user_id)

      if (verifyUserError) {
        console.error('[auth/verify] verify user failed:', verifyUserError)
        return sendVerifyResponse(response, 500, {
          ok: false,
          message: 'Could not verify account.',
          appBaseUrl,
        })
      }

      await supabaseAdminClient.from('email_verification_tokens').delete().eq('id', tokenRow.id)
      return sendVerifyResponse(response, 200, {
        ok: true,
        message: 'Email verified successfully.',
        appBaseUrl,
      })
    } catch (error) {
      console.error('[auth/verify] unexpected error:', error)
      return sendVerifyResponse(response, 500, {
        ok: false,
        message: 'Unexpected server error.',
        appBaseUrl,
      })
    }
  })

  router.post('/login', async (request: Request, response: Response) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) {
      return respondValidationError(parsed.error, response)
    }

    if (!supabaseAdminClient || !jwtSecret) {
      return response.status(500).json({
        ok: false,
        error: 'Server auth configuration missing: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY or JWT_SECRET',
      })
    }

    const email = normalizeEmail(parsed.data.email)
    const password = parsed.data.password

    try {
      const { data: user, error: userError } = await supabaseAdminClient
        .from('users')
        .select('id, email, password_hash, is_verified')
        .eq('email', email)
        .maybeSingle<UserRow>()

      if (userError) {
        console.error('[auth/login] user lookup failed:', userError)
        return response.status(500).json({ ok: false, error: 'Failed to query user' })
      }

      if (!user) {
        return response.status(401).json({ ok: false, error: 'Invalid email or password' })
      }

      if (!user.is_verified) {
        return response.status(403).json({ ok: false, error: 'Email not verified' })
      }

      const passwordMatches = await bcrypt.compare(password, user.password_hash)
      if (!passwordMatches) {
        return response.status(401).json({ ok: false, error: 'Invalid email or password' })
      }

      const client = await fetchClientForUser(supabaseAdminClient, user.id)
      if (!client) {
        return response.status(500).json({ ok: false, error: 'Client profile missing for user' })
      }

      if (client.user_id !== user.id) {
        return response.status(403).json({ ok: false, error: 'Client ownership mismatch' })
      }

      const token = signAuthToken(
        {
          userId: user.id,
          email: user.email,
          clientId: client.id,
        },
        jwtSecret,
      )

      response.cookie('kufu_session', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })

      return response.json({
        ok: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          is_verified: user.is_verified,
        },
        client: {
          id: client.id,
          business_name: client.business_name,
          website_url: client.website_url,
          plan: client.plan,
        },
      })
    } catch (error) {
      console.error('[auth/login] unexpected error:', error)
      return response.status(500).json({ ok: false, error: 'Server error while logging in' })
    }
  })

  router.get('/me', authMiddleware(jwtSecret), async (request: Request, response: Response) => {
    if (!supabaseAdminClient) {
      return response.status(500).json({
        ok: false,
        error: 'Server auth configuration missing: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY',
      })
    }

    const authRequest = request as AuthenticatedRequest
    const { userId, clientId } = authRequest.user

    try {
      const { data: user, error: userError } = await supabaseAdminClient
        .from('users')
        .select('id, email, is_verified')
        .eq('id', userId)
        .maybeSingle<RegisterUserRow>()

      if (userError) {
        console.error('[auth/me] user lookup failed:', userError)
        return response.status(500).json({ ok: false, error: 'Failed to query user' })
      }

      if (!user) {
        return response.status(401).json({ ok: false, error: 'Unauthorized' })
      }

      const { data: client, error: clientError } = await supabaseAdminClient
        .from('clients')
        .select('id, user_id, business_name, website_url, plan')
        .eq('id', clientId)
        .eq('user_id', userId)
        .maybeSingle<ClientRow>()

      if (clientError) {
        console.error('[auth/me] client lookup failed:', clientError)
        return response.status(500).json({ ok: false, error: 'Failed to query client' })
      }

      if (!client) {
        return response.status(401).json({ ok: false, error: 'Unauthorized' })
      }

      return response.json({
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          is_verified: user.is_verified,
        },
        client: {
          id: client.id,
          business_name: client.business_name,
          website_url: client.website_url,
          plan: client.plan,
        },
      })
    } catch (error) {
      console.error('[auth/me] unexpected error:', error)
      return response.status(500).json({ ok: false, error: 'Server error while loading profile' })
    }
  })

  router.post('/logout', (_request: Request, response: Response) => {
    response.clearCookie('kufu_session', {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      path: '/',
    })

    return response.json({ ok: true })
  })

  return router
}
