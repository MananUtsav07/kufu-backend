import { Router } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'

import { authMiddleware, requireAdmin, type AuthenticatedRequest } from '../lib/auth-middleware.js'
import { asyncHandler, AppError } from '../lib/errors.js'
import { respondValidationError } from '../lib/http.js'
import {
  adminMessagesQuerySchema,
  adminQuotePatchSchema,
  adminSetPlanSchema,
  adminTicketPatchSchema,
} from '../schemas/admin.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  ensureSubscription,
  resetExpiredSubscriptionPeriods,
  setSubscriptionPlan,
} from '../services/subscriptionService.js'
import { loadClientByUserId, loadUserById } from '../services/tenantService.js'

type AdminRouterOptions = {
  jwtSecret: string
  supabaseAdminClient: SupabaseClient
}

function asAuthenticatedRequest(request: unknown): AuthenticatedRequest {
  return request as AuthenticatedRequest
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return ''
  }

  const headers = Object.keys(rows[0])
  const escapeCell = (value: unknown) => {
    const raw = value == null ? '' : String(value)
    if (/[",\n]/.test(raw)) {
      return `"${raw.replace(/"/g, '""')}"`
    }
    return raw
  }

  const headerRow = headers.join(',')
  const dataRows = rows.map((row) => headers.map((key) => escapeCell(row[key])).join(','))
  return [headerRow, ...dataRows].join('\n')
}

function toSingleParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim().length > 0) {
    return value[0]
  }

  return null
}

export function createAdminRouter(options: AdminRouterOptions): Router {
  const router = Router()

  router.use(authMiddleware(options.jwtSecret))
  router.use(requireAdmin)

  router.get(
    '/overview',
    asyncHandler(async (_request, response) => {
      const [{ count: totalUsers }, { count: totalClients }, { data: subscriptions }, { count: messages24h }, { count: messages7d }] =
        await Promise.all([
          options.supabaseAdminClient.from('users').select('id', { count: 'exact', head: true }),
          options.supabaseAdminClient.from('clients').select('id', { count: 'exact', head: true }),
          options.supabaseAdminClient
            .from('subscriptions')
            .select('plan_code, status')
            .eq('status', 'active'),
          options.supabaseAdminClient
            .from('chatbot_messages')
            .select('id', { count: 'exact', head: true })
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
          options.supabaseAdminClient
            .from('chatbot_messages')
            .select('id', { count: 'exact', head: true })
            .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
        ])

      const activeByPlan = (subscriptions ?? []).reduce<Record<string, number>>((acc, item) => {
        const planCode = String((item as { plan_code?: unknown }).plan_code ?? 'unknown')
        acc[planCode] = (acc[planCode] ?? 0) + 1
        return acc
      }, {})

      response.json({
        ok: true,
        overview: {
          total_users: totalUsers ?? 0,
          total_clients: totalClients ?? 0,
          active_subscriptions_by_plan: activeByPlan,
          total_messages_last_24h: messages24h ?? 0,
          total_messages_last_7d: messages7d ?? 0,
        },
      })
    }),
  )

  router.get(
    '/messages',
    asyncHandler(async (request, response) => {
      const parsed = adminMessagesQuerySchema.safeParse(request.query)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const { limit, offset, user_id: userId, chatbot_id: chatbotId, from, to } = parsed.data

      let query = options.supabaseAdminClient
        .from('chatbot_messages')
        .select('id, user_id, chatbot_id, session_id, role, content, tokens_estimate, created_at', {
          count: 'exact',
        })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (userId) {
        query = query.eq('user_id', userId)
      }
      if (chatbotId) {
        query = query.eq('chatbot_id', chatbotId)
      }
      if (from) {
        query = query.gte('created_at', from)
      }
      if (to) {
        query = query.lte('created_at', to)
      }

      const { data, count, error } = await query

      if (error) {
        throw new AppError('Failed to load messages', 500, error)
      }

      response.json({
        ok: true,
        messages: data ?? [],
        pagination: {
          limit,
          offset,
          total: count ?? 0,
        },
      })
    }),
  )

  router.get(
    '/messages/export',
    asyncHandler(async (request, response) => {
      const parsed = adminMessagesQuerySchema.safeParse(request.query)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const { user_id: userId, chatbot_id: chatbotId, from, to } = parsed.data

      let query = options.supabaseAdminClient
        .from('chatbot_messages')
        .select('id, user_id, chatbot_id, session_id, role, content, tokens_estimate, created_at')
        .order('created_at', { ascending: false })
        .limit(5000)

      if (userId) {
        query = query.eq('user_id', userId)
      }
      if (chatbotId) {
        query = query.eq('chatbot_id', chatbotId)
      }
      if (from) {
        query = query.gte('created_at', from)
      }
      if (to) {
        query = query.lte('created_at', to)
      }

      const { data, error } = await query
      if (error) {
        throw new AppError('Failed to export messages', 500, error)
      }

      const csv = toCsv((data ?? []) as Array<Record<string, unknown>>)
      response.setHeader('Content-Type', 'text/csv; charset=utf-8')
      response.setHeader('Content-Disposition', 'attachment; filename="kufu-messages.csv"')
      response.status(200).send(csv)
    }),
  )

  router.get(
    '/tickets',
    asyncHandler(async (_request, response) => {
      const { data, error } = await options.supabaseAdminClient
        .from('tickets')
        .select('id, user_id, subject, message, admin_response, status, created_at, updated_at')
        .order('created_at', { ascending: false })

      if (error) {
        throw new AppError('Failed to load tickets', 500, error)
      }

      response.json({ ok: true, tickets: data ?? [] })
    }),
  )

  router.patch(
    '/tickets/:id',
    asyncHandler(async (request, response) => {
      const parsed = adminTicketPatchSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const ticketId = toSingleParam(request.params.id)
      if (!ticketId) {
        throw new AppError('Ticket id is required', 400)
      }

      const updatePayload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }
      if (parsed.data.status !== undefined) {
        updatePayload.status = parsed.data.status
      }
      if (parsed.data.admin_response !== undefined) {
        updatePayload.admin_response = parsed.data.admin_response
      }

      const { data, error } = await options.supabaseAdminClient
        .from('tickets')
        .update(updatePayload)
        .eq('id', ticketId)
        .select('id, user_id, subject, message, admin_response, status, created_at, updated_at')
        .single()

      if (error || !data) {
        throw new AppError('Failed to update ticket', 500, error)
      }

      await writeAuditLog({
        supabaseAdminClient: options.supabaseAdminClient,
        actorUserId: asAuthenticatedRequest(request).user.userId,
        action: 'admin.ticket.update',
        metadata: { ticketId },
      })

      response.json({ ok: true, ticket: data })
    }),
  )

  router.get(
    '/quotes',
    asyncHandler(async (_request, response) => {
      const { data, error } = await options.supabaseAdminClient
        .from('custom_quotes')
        .select(
          'id, user_id, requested_plan, requested_chatbots, requested_unlimited_messages, notes, status, admin_response, created_at, updated_at',
        )
        .order('created_at', { ascending: false })

      if (error) {
        throw new AppError('Failed to load quote requests', 500, error)
      }

      response.json({ ok: true, quotes: data ?? [] })
    }),
  )

  router.patch(
    '/quotes/:id',
    asyncHandler(async (request, response) => {
      const parsed = adminQuotePatchSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const quoteId = toSingleParam(request.params.id)
      if (!quoteId) {
        throw new AppError('Quote id is required', 400)
      }

      const updatePayload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }
      if (parsed.data.status !== undefined) {
        updatePayload.status = parsed.data.status
      }
      if (parsed.data.admin_response !== undefined) {
        updatePayload.admin_response = parsed.data.admin_response
      }

      const { data: updatedQuote, error: quoteError } = await options.supabaseAdminClient
        .from('custom_quotes')
        .update(updatePayload)
        .eq('id', quoteId)
        .select(
          'id, user_id, requested_plan, requested_chatbots, requested_unlimited_messages, notes, status, admin_response, created_at, updated_at',
        )
        .single()

      if (quoteError || !updatedQuote) {
        throw new AppError('Failed to update quote request', 500, quoteError)
      }

      if (parsed.data.approve_plan) {
        await setSubscriptionPlan(options.supabaseAdminClient, updatedQuote.user_id, parsed.data.approve_plan)
        await options.supabaseAdminClient
          .from('clients')
          .update({ plan: parsed.data.approve_plan })
          .eq('user_id', updatedQuote.user_id)
      }

      await writeAuditLog({
        supabaseAdminClient: options.supabaseAdminClient,
        actorUserId: asAuthenticatedRequest(request).user.userId,
        action: 'admin.quote.update',
        metadata: {
          quoteId,
          approvePlan: parsed.data.approve_plan ?? null,
        },
      })

      response.json({ ok: true, quote: updatedQuote })
    }),
  )

  router.post(
    '/subscriptions/:userId/set-plan',
    asyncHandler(async (request, response) => {
      const parsed = adminSetPlanSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const userId = toSingleParam(request.params.userId)
      if (!userId) {
        throw new AppError('userId is required', 400)
      }

      await ensureSubscription(options.supabaseAdminClient, userId)
      const subscription = await setSubscriptionPlan(options.supabaseAdminClient, userId, parsed.data.plan_code)

      await options.supabaseAdminClient
        .from('clients')
        .update({ plan: parsed.data.plan_code })
        .eq('user_id', userId)

      await writeAuditLog({
        supabaseAdminClient: options.supabaseAdminClient,
        actorUserId: asAuthenticatedRequest(request).user.userId,
        action: 'admin.subscription.set_plan',
        metadata: {
          userId,
          planCode: parsed.data.plan_code,
        },
      })

      response.json({ ok: true, subscription })
    }),
  )

  router.post(
    '/maintenance/reset-periods',
    asyncHandler(async (request, response) => {
      const resetCount = await resetExpiredSubscriptionPeriods(options.supabaseAdminClient)

      await writeAuditLog({
        supabaseAdminClient: options.supabaseAdminClient,
        actorUserId: asAuthenticatedRequest(request).user.userId,
        action: 'admin.maintenance.reset_periods',
        metadata: {
          resetCount,
        },
      })

      response.json({
        ok: true,
        reset_count: resetCount,
      })
    }),
  )

  router.get(
    '/impersonate/:userId',
    asyncHandler(async (request, response) => {
      const userId = toSingleParam(request.params.userId)
      if (!userId) {
        throw new AppError('userId is required', 400)
      }

      const user = await loadUserById(options.supabaseAdminClient, userId)
      if (!user) {
        throw new AppError('User not found', 404)
      }

      const client = await loadClientByUserId(options.supabaseAdminClient, user.id)
      response.json({
        ok: true,
        user: user
          ? {
              id: user.id,
              email: user.email,
              role: user.role,
            }
          : null,
        client,
      })
    }),
  )

  return router
}
