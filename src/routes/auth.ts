import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'
import { rateLimit } from 'express-rate-limit'

import { authMiddleware, type AuthenticatedRequest } from '../lib/auth-middleware.js'
import { asyncHandler, AppError } from '../lib/errors.js'
import { respondValidationError } from '../lib/http.js'
import { signAuthToken } from '../lib/jwt.js'
import type { createMailer } from '../lib/mailer.js'
import { normalizeEmail } from '../lib/validation.js'
import { loginSchema, registerSchema, verifyEmailSchema, authTokenQuerySchema } from '../schemas/auth.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  ensureClientForUser,
  loadClientByUserId,
  loadUserByEmail,
  loadUserById,
  type ClientRow,
  type UserRow,
} from '../services/tenantService.js'
import { ensureSubscription, loadPlanByCode } from '../services/subscriptionService.js'

export type Mailer = ReturnType<typeof createMailer>

type AuthRouterOptions = {
  isProduction: boolean
  appBaseUrl: string
  backendBaseUrl: string
  jwtSecret: string
  supabaseAdminClient: SupabaseClient
  mailer: Mailer
  allowDevBypassEmailVerify: boolean
}

type VerificationTokenRow = {
  id: string
  user_id: string
  email: string
  token: string
  expires_at: string
  created_at: string
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function verificationHtml(status: 'success' | 'error', message: string, appBaseUrl: string): string {
  const loginUrl = `${trimTrailingSlash(appBaseUrl)}/login`
  const isSuccess = status === 'success'

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Email verification</title>
    ${isSuccess ? `<meta http-equiv="refresh" content="2;url=${loginUrl}" />` : ''}
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#020617;color:#e2e8f0;font-family:Inter,Arial,sans-serif;padding:24px}
      .card{width:min(580px,100%);background:#0f172a;border:1px solid rgba(148,163,184,.25);border-radius:16px;padding:24px}
      h1{margin:0 0 10px;font-size:24px}
      p{margin:0 0 16px;line-height:1.5;color:#cbd5e1}
      a{color:#818cf8;text-decoration:none;font-weight:600}
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${isSuccess ? 'Email verified' : 'Verification failed'}</h1>
      <p>${message}</p>
      <a href="${loginUrl}">Go to login</a>
      ${isSuccess ? '<p>Redirecting in 2 seconds...</p>' : ''}
    </div>
  </body>
</html>`
}

function isTokenExpired(expiresAtIso: string): boolean {
  const expiresAt = new Date(expiresAtIso).getTime()
  return Number.isNaN(expiresAt) || expiresAt < Date.now()
}

async function getVerificationTokenRow(
  supabaseAdminClient: SupabaseClient,
  token: string,
): Promise<VerificationTokenRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('email_verification_tokens')
    .select('id, user_id, email, token, expires_at, created_at')
    .eq('token', token)
    .maybeSingle<VerificationTokenRow>()

  if (error) {
    throw new AppError(`Failed to query verification token: ${error.message}`, 500)
  }

  return data ?? null
}

async function insertOrRotateVerificationToken(args: {
  supabaseAdminClient: SupabaseClient
  userId: string
  email: string
}): Promise<{ token: string; expiresInMinutes: number }> {
  const token = randomBytes(32).toString('hex')
  const expiresInMinutes = 10
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString()

  await args.supabaseAdminClient.from('email_verification_tokens').delete().eq('user_id', args.userId)

  const { error } = await args.supabaseAdminClient.from('email_verification_tokens').insert({
    user_id: args.userId,
    email: args.email,
    token,
    expires_at: expiresAt,
  })

  if (error) {
    throw new AppError(`Failed to create verification token: ${error.message}`, 500)
  }

  return { token, expiresInMinutes }
}

async function ensureUserAndClient(args: {
  supabaseAdminClient: SupabaseClient
  email: string
  passwordHash: string
  businessName: string
  websiteUrl: string | null
}): Promise<{ user: UserRow; client: ClientRow }> {
  const existingUser = await loadUserByEmail(args.supabaseAdminClient, args.email)

  if (existingUser?.is_verified) {
    throw new AppError('Email already registered', 409)
  }

  let userId = existingUser?.id

  if (!userId) {
    const { data: createdUser, error: createUserError } = await args.supabaseAdminClient
      .from('users')
      .insert({
        email: args.email,
        password_hash: args.passwordHash,
        is_verified: false,
        role: 'user',
      })
      .select('id, email, password_hash, is_verified, role, created_at')
      .single<UserRow>()

    if (createUserError || !createdUser) {
      throw new AppError(`Failed to create user: ${createUserError?.message || 'unknown error'}`, 500)
    }

    userId = createdUser.id
  } else {
    const { error: updateUserError } = await args.supabaseAdminClient
      .from('users')
      .update({
        password_hash: args.passwordHash,
        is_verified: false,
      })
      .eq('id', userId)

    if (updateUserError) {
      throw new AppError(`Failed to update unverified user: ${updateUserError.message}`, 500)
    }
  }

  const client = await ensureClientForUser(args.supabaseAdminClient, {
    userId,
    businessName: args.businessName,
    websiteUrl: args.websiteUrl,
  })

  const user = await loadUserById(args.supabaseAdminClient, userId)
  if (!user) {
    throw new AppError('Failed to load newly created user', 500)
  }

  return {
    user,
    client,
  }
}

async function verifyTokenAndActivateUser(args: {
  supabaseAdminClient: SupabaseClient
  token: string
}): Promise<{ userId: string; email: string }> {
  const row = await getVerificationTokenRow(args.supabaseAdminClient, args.token)
  if (!row) {
    throw new AppError('Invalid verification token', 400)
  }

  if (isTokenExpired(row.expires_at)) {
    await args.supabaseAdminClient.from('email_verification_tokens').delete().eq('id', row.id)
    throw new AppError('Verification token expired', 400)
  }

  const { error: userUpdateError } = await args.supabaseAdminClient
    .from('users')
    .update({ is_verified: true })
    .eq('id', row.user_id)

  if (userUpdateError) {
    throw new AppError(`Failed to verify user: ${userUpdateError.message}`, 500)
  }

  await args.supabaseAdminClient.from('email_verification_tokens').delete().eq('id', row.id)

  return {
    userId: row.user_id,
    email: row.email,
  }
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router()

  const authLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 25,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      ok: false,
      error: 'Too many auth requests. Please try again later.',
    },
  })

  router.use(authLimiter)

  router.post(
    '/register',
    asyncHandler(async (request, response) => {
      const parsed = registerSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const normalizedEmail = normalizeEmail(parsed.data.email)
      const passwordHash = await bcrypt.hash(parsed.data.password, 12)

      const { user } = await ensureUserAndClient({
        supabaseAdminClient: options.supabaseAdminClient,
        email: normalizedEmail,
        passwordHash,
        businessName: parsed.data.business_name?.trim() || 'Kufu Client',
        websiteUrl: parsed.data.website_url?.trim() || null,
      })

      const verificationToken = await insertOrRotateVerificationToken({
        supabaseAdminClient: options.supabaseAdminClient,
        userId: user.id,
        email: normalizedEmail,
      })

      const verificationUrl = `${trimTrailingSlash(options.appBaseUrl)}/verify?token=${encodeURIComponent(verificationToken.token)}`
      const backendVerifyUrl = `${trimTrailingSlash(options.backendBaseUrl)}/api/auth/verify?token=${encodeURIComponent(verificationToken.token)}`

      if (options.mailer) {
        try {
          await options.mailer.sendVerificationEmail({
            to: normalizedEmail,
            verificationUrl,
            fallbackVerificationUrl: backendVerifyUrl,
            expiresInMinutes: verificationToken.expiresInMinutes,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown SMTP error'
          throw new AppError(
            'Unable to send verification email right now. Please retry in a minute.',
            503,
            { smtpError: message },
          )
        }
      }

      await writeAuditLog({
        supabaseAdminClient: options.supabaseAdminClient,
        actorUserId: user.id,
        action: 'auth.register',
        metadata: { email: normalizedEmail },
      })

      return response.status(201).json({
        ok: true,
        ...(options.allowDevBypassEmailVerify ? { devToken: verificationToken.token } : {}),
      })
    }),
  )

  router.post(
    '/verify-email',
    asyncHandler(async (request, response) => {
      const parsed = verifyEmailSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const activated = await verifyTokenAndActivateUser({
        supabaseAdminClient: options.supabaseAdminClient,
        token: parsed.data.token,
      })

      await ensureSubscription(options.supabaseAdminClient, activated.userId)

      await writeAuditLog({
        supabaseAdminClient: options.supabaseAdminClient,
        actorUserId: activated.userId,
        action: 'auth.verify_email',
        metadata: { email: activated.email },
      })

      return response.json({ ok: true })
    }),
  )

  router.get(
    '/verify',
    asyncHandler(async (request, response) => {
      const parsed = authTokenQuerySchema.safeParse({
        token: request.query.token,
      })

      if (!parsed.success || !parsed.data.token) {
        response.status(400).type('html').send(verificationHtml('error', 'Invalid verification link.', options.appBaseUrl))
        return
      }

      try {
        const activated = await verifyTokenAndActivateUser({
          supabaseAdminClient: options.supabaseAdminClient,
          token: parsed.data.token,
        })

        await ensureSubscription(options.supabaseAdminClient, activated.userId)

        response
          .status(200)
          .type('html')
          .send(verificationHtml('success', 'Email verified successfully.', options.appBaseUrl))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Verification failed.'
        response.status(400).type('html').send(verificationHtml('error', message, options.appBaseUrl))
      }
    }),
  )

  router.post(
    '/login',
    asyncHandler(async (request: Request, response: Response) => {
      const parsed = loginSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const normalizedEmail = normalizeEmail(parsed.data.email)
      const user = await loadUserByEmail(options.supabaseAdminClient, normalizedEmail)
      if (!user) {
        throw new AppError('Invalid email or password', 401)
      }

      const passwordMatches = await bcrypt.compare(parsed.data.password, user.password_hash)
      if (!passwordMatches) {
        throw new AppError('Invalid email or password', 401)
      }

      if (!user.is_verified && !options.allowDevBypassEmailVerify) {
        throw new AppError('Email not verified', 403)
      }

      const client = await loadClientByUserId(options.supabaseAdminClient, user.id)
      if (!client) {
        throw new AppError('Client profile missing for user', 500)
      }

      const subscription = await ensureSubscription(options.supabaseAdminClient, user.id)
      const plan = await loadPlanByCode(options.supabaseAdminClient, subscription.plan_code)

      const token = signAuthToken(
        {
          userId: user.id,
          email: user.email,
          clientId: client.id,
          role: user.role,
        },
        options.jwtSecret,
      )

      response.cookie('kufu_session', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: options.isProduction,
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })

      await writeAuditLog({
        supabaseAdminClient: options.supabaseAdminClient,
        actorUserId: user.id,
        action: 'auth.login',
      })

      return response.json({
        ok: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          is_verified: user.is_verified,
          role: user.role,
        },
        client: {
          id: client.id,
          business_name: client.business_name,
          website_url: client.website_url,
          plan: plan.code,
        },
        subscription,
        plan,
      })
    }),
  )

  router.get(
    '/me',
    authMiddleware(options.jwtSecret),
    asyncHandler(async (request, response) => {
      const authRequest = request as AuthenticatedRequest
      const user = await loadUserById(options.supabaseAdminClient, authRequest.user.userId)
      if (!user) {
        throw new AppError('Unauthorized', 401)
      }

      const client = await loadClientByUserId(options.supabaseAdminClient, user.id)
      if (!client) {
        throw new AppError('Client profile missing for user', 500)
      }

      const subscription = await ensureSubscription(options.supabaseAdminClient, user.id)
      const plan = await loadPlanByCode(options.supabaseAdminClient, subscription.plan_code)

      response.json({
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          is_verified: user.is_verified,
          role: user.role,
        },
        client: {
          id: client.id,
          business_name: client.business_name,
          website_url: client.website_url,
          plan: plan.code,
        },
        subscription,
        plan,
      })
    }),
  )

  router.post('/logout', (_request, response) => {
    response.clearCookie('kufu_session', {
      httpOnly: true,
      sameSite: 'lax',
      secure: options.isProduction,
      path: '/',
    })

    response.json({ ok: true })
  })

  return router
}
