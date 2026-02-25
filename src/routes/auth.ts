import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'

import { clearSessionCookie, createSessionToken, getUserFromRequest, setSessionCookie } from '../lib/authSession.js'
import type { createMailer } from '../lib/mailer.js'
import { loginSchema, registerSchema, verifyQuerySchema } from '../schemas/auth.js'
import { respondValidationError } from '../lib/http.js'

type Mailer = ReturnType<typeof createMailer>

type AuthRouterOptions = {
  isProduction: boolean
  appUrl: string
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

type UserSummaryRow = {
  id: string
  email: string
  is_verified: boolean
}

type VerificationTokenRow = {
  id: string
  user_id: string
  email: string
  token: string
  expires_at: string
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function isExpired(expiresAtIso: string): boolean {
  const timestamp = new Date(expiresAtIso).getTime()
  return Number.isNaN(timestamp) || timestamp < Date.now()
}

function wantsJsonResponse(request: Request): boolean {
  const format = asQueryParam(request.query.format)
  if (format === 'json') {
    return true
  }

  const accept = request.header('accept') ?? ''
  return accept.includes('application/json')
}

function sendVerifyHtml(
  response: Response,
  payload: { ok: boolean; title: string; message: string; appUrl: string },
  status: number,
) {
  const { ok, title, message, appUrl } = payload
  const safeTitle = escapeHtml(title)
  const safeMessage = escapeHtml(message)
  const loginUrl = `${trimTrailingSlash(appUrl)}/login`

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    ${ok ? `<meta http-equiv="refresh" content="2;url=${loginUrl}" />` : ''}
    <style>
      body { margin: 0; font-family: Inter, Arial, sans-serif; background: #0b1024; color: #f8fafc; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      .card { width: min(520px, 100%); border-radius: 16px; background: #121a38; border: 1px solid rgba(148,163,184,0.2); padding: 24px; box-shadow: 0 20px 50px rgba(0,0,0,0.35); }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 0 0 20px; color: #cbd5e1; line-height: 1.5; }
      a { color: #60a5fa; text-decoration: none; }
      .hint { font-size: 13px; color: #94a3b8; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
      <a href="${loginUrl}">Go to login</a>
      ${
        ok
          ? '<p class="hint">Redirecting to login in 2 seconds...</p>'
          : '<p class="hint">You can request a new verification email from the create account page.</p>'
      }
    </div>
  </body>
</html>`

  response.status(status).type('html').send(html)
}

function sendVerifyResponse(
  request: Request,
  response: Response,
  payload: { ok: boolean; title: string; message: string; appUrl: string },
  status: number,
) {
  if (wantsJsonResponse(request)) {
    if (payload.ok) {
      response.status(status).json({ ok: true, message: payload.message })
      return
    }

    response.status(status).json({ ok: false, error: payload.message })
    return
  }

  sendVerifyHtml(response, payload, status)
}

export function createAuthRouter({
  isProduction,
  appUrl,
  jwtSecret,
  supabaseAdminClient,
  mailer,
}: AuthRouterOptions): Router {
  const router = Router()

  router.post('/register', async (request: Request, response: Response) => {
    const parsed = registerSchema.safeParse(request.body)
    if (!parsed.success) {
      return respondValidationError(parsed.error, response)
    }

    if (!supabaseAdminClient || !mailer) {
      return response.status(500).json({
        ok: false,
        error: 'Server auth configuration missing: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY or EMAIL_USER/EMAIL_PASS',
      })
    }

    const supabase = supabaseAdminClient
    const authMailer = mailer

    const email = normalizeEmail(parsed.data.email)
    const passwordHash = await bcrypt.hash(parsed.data.password, 12)

    try {
      const { data: existingUser, error: existingUserError } = await supabase
        .from('users')
        .select('id, email, is_verified')
        .eq('email', email)
        .maybeSingle<UserSummaryRow>()

      if (existingUserError) {
        console.error('[auth/register] existing user lookup failed:', existingUserError)
        return response.status(500).json({ ok: false, error: 'Failed to query user' })
      }

      if (existingUser?.is_verified) {
        return response.status(409).json({ ok: false, error: 'Email already registered' })
      }

      let userId = existingUser?.id

      if (!userId) {
        const { data: insertedUser, error: insertUserError } = await supabase
          .from('users')
          .insert({
            email,
            password_hash: passwordHash,
            is_verified: false,
          })
          .select('id')
          .single<{ id: string }>()

        if (insertUserError || !insertedUser) {
          console.error('[auth/register] insert user failed:', insertUserError)
          return response.status(500).json({ ok: false, error: 'Failed to create user' })
        }

        userId = insertedUser.id
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

      const token = randomBytes(32).toString('hex')
      const expiresInMinutes = 10
      const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString()

      const { error: deleteTokenError } = await supabase
        .from('email_verification_tokens')
        .delete()
        .eq('email', email)

      if (deleteTokenError) {
        console.error('[auth/register] delete old token failed:', deleteTokenError)
        return response.status(500).json({ ok: false, error: 'Failed to rotate verification token' })
      }

      const { error: insertTokenError } = await supabase.from('email_verification_tokens').insert({
        email,
        token,
        expires_at: expiresAt,
        user_id: userId,
      })

      if (insertTokenError) {
        console.error('[auth/register] insert token failed:', insertTokenError)
        return response.status(500).json({ ok: false, error: 'Failed to create verification token' })
      }

      const query = new URLSearchParams({ token, email }).toString()
      const verificationUrl = `${trimTrailingSlash(appUrl)}/verify?${query}`

      const forwardedProto = request.header('x-forwarded-proto')
      const protocol = forwardedProto ? forwardedProto.split(',')[0].trim() : request.protocol
      const host = request.get('host')
      const backendBase = host ? `${protocol}://${host}` : trimTrailingSlash(appUrl)
      const fallbackVerificationUrl = `${backendBase}/api/auth/verify?${query}`

      try {
        await authMailer.sendVerificationEmail({
          to: email,
          verificationUrl,
          fallbackVerificationUrl,
          expiresInMinutes,
        })
      } catch (mailError) {
        console.error('[auth/register] verification email failed:', mailError)
        return response.status(500).json({ ok: false, error: 'Failed to send verification email' })
      }

      return response.json({ ok: true })
    } catch (error) {
      console.error('[auth/register] unexpected error:', error)
      return response.status(500).json({ ok: false, error: 'Server error while registering user' })
    }
  })

  router.get('/verify', async (request: Request, response: Response) => {
    if (!supabaseAdminClient) {
      return sendVerifyResponse(
        request,
        response,
        {
          ok: false,
          title: 'Verification unavailable',
          message: 'Server auth configuration is missing.',
          appUrl,
        },
        500,
      )
    }

    const token = asQueryParam(request.query.token)
    const email = asQueryParam(request.query.email)
    const parsedQuery = verifyQuerySchema.safeParse({
      token,
      email,
    })

    if (!parsedQuery.success) {
      return sendVerifyResponse(
        request,
        response,
        {
          ok: false,
          title: 'Invalid verification link',
          message: 'The verification link is missing required fields.',
          appUrl,
        },
        400,
      )
    }

    const normalizedEmail = normalizeEmail(parsedQuery.data.email)

    try {
      const { data: tokenRow, error: tokenError } = await supabaseAdminClient
        .from('email_verification_tokens')
        .select('id, user_id, email, token, expires_at')
        .eq('token', parsedQuery.data.token)
        .eq('email', normalizedEmail)
        .maybeSingle<VerificationTokenRow>()

      if (tokenError) {
        console.error('[auth/verify] token lookup failed:', tokenError)
        return sendVerifyResponse(
          request,
          response,
          {
            ok: false,
            title: 'Verification failed',
            message: 'Unable to verify this link right now.',
            appUrl,
          },
          500,
        )
      }

      if (!tokenRow) {
        return sendVerifyResponse(
          request,
          response,
          {
            ok: false,
            title: 'Invalid verification link',
            message: 'This verification link is invalid or has already been used.',
            appUrl,
          },
          400,
        )
      }

      if (isExpired(tokenRow.expires_at)) {
        await supabaseAdminClient.from('email_verification_tokens').delete().eq('id', tokenRow.id)
        return sendVerifyResponse(
          request,
          response,
          {
            ok: false,
            title: 'Verification link expired',
            message: 'This verification link has expired. Please request a new one.',
            appUrl,
          },
          400,
        )
      }

      const { error: updateUserError } = await supabaseAdminClient
        .from('users')
        .update({ is_verified: true })
        .eq('id', tokenRow.user_id)

      if (updateUserError) {
        console.error('[auth/verify] user verify update failed:', updateUserError)
        return sendVerifyResponse(
          request,
          response,
          {
            ok: false,
            title: 'Verification failed',
            message: 'Could not activate your account. Please try again.',
            appUrl,
          },
          500,
        )
      }

      const { error: deleteTokenError } = await supabaseAdminClient
        .from('email_verification_tokens')
        .delete()
        .eq('id', tokenRow.id)

      if (deleteTokenError) {
        console.error('[auth/verify] token cleanup failed:', deleteTokenError)
        return sendVerifyResponse(
          request,
          response,
          {
            ok: false,
            title: 'Verification failed',
            message: 'Your account was updated, but cleanup failed. Please try signing in.',
            appUrl,
          },
          500,
        )
      }

      return sendVerifyResponse(
        request,
        response,
        {
          ok: true,
          title: 'Email verified',
          message: 'Your email was verified successfully.',
          appUrl,
        },
        200,
      )
    } catch (error) {
      console.error('[auth/verify] unexpected error:', error)
      return sendVerifyResponse(
        request,
        response,
        {
          ok: false,
          title: 'Verification failed',
          message: 'Unexpected server error. Please try again.',
          appUrl,
        },
        500,
      )
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
        return response.status(403).json({ ok: false, error: 'Please verify your email' })
      }

      const isPasswordValid = await bcrypt.compare(password, user.password_hash)
      if (!isPasswordValid) {
        return response.status(401).json({ ok: false, error: 'Invalid email or password' })
      }

      const token = createSessionToken(
        {
          sub: user.id,
          email: user.email,
        },
        jwtSecret,
      )

      setSessionCookie(response, token, isProduction)

      return response.json({
        ok: true,
        user: {
          id: user.id,
          email: user.email,
        },
      })
    } catch (error) {
      console.error('[auth/login] unexpected error:', error)
      return response.status(500).json({ ok: false, error: 'Server error while signing in' })
    }
  })

  router.get('/me', async (request: Request, response: Response) => {
    if (!supabaseAdminClient || !jwtSecret) {
      return response.status(500).json({
        ok: false,
        error: 'Server auth configuration missing: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY or JWT_SECRET',
      })
    }

    const sessionUser = getUserFromRequest(request, jwtSecret)
    if (!sessionUser) {
      return response.status(401).json({ ok: false, error: 'Unauthorized' })
    }

    try {
      const { data: user, error: userError } = await supabaseAdminClient
        .from('users')
        .select('id, email, is_verified')
        .eq('id', sessionUser.sub)
        .maybeSingle<UserSummaryRow>()

      if (userError) {
        console.error('[auth/me] user lookup failed:', userError)
        return response.status(500).json({ ok: false, error: 'Failed to query user' })
      }

      if (!user) {
        return response.status(401).json({ ok: false, error: 'Unauthorized' })
      }

      return response.json({
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          isVerified: Boolean(user.is_verified),
        },
      })
    } catch (error) {
      console.error('[auth/me] unexpected error:', error)
      return response.status(500).json({ ok: false, error: 'Server error while loading user' })
    }
  })

  router.post('/logout', (_request: Request, response: Response) => {
    clearSessionCookie(response, isProduction)
    return response.json({ ok: true })
  })

  return router
}
