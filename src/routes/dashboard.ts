import { Router } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'

import { authMiddleware, type AuthenticatedRequest } from '../lib/auth-middleware.js'
import { asyncHandler, AppError } from '../lib/errors.js'
import { respondValidationError } from '../lib/http.js'
import {
  dashboardChatbotCreateSchema,
  dashboardChatbotUpdateSchema,
  dashboardKnowledgeSchema,
  dashboardLeadStatusSchema,
  dashboardLeadsQuerySchema,
  dashboardProfileSchema,
  dashboardQuoteCreateSchema,
  dashboardSummaryQuerySchema,
  dashboardTicketCreateSchema,
  dashboardTicketUpdateSchema,
} from '../schemas/dashboard.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  ensureClientForUser,
  ensureDefaultChatbot,
  ensureTenantOwnership,
  loadChatbotById,
  loadUserById,
  loadUserChatbots,
  buildAllowedDomains,
  createWidgetPublicKey,
} from '../services/tenantService.js'
import {
  ensureSubscription,
  enforcePlanMessageLimit,
  loadPlanByCode,
  resolveChatbotLimitForPlan,
} from '../services/subscriptionService.js'

type DashboardRouterOptions = {
  jwtSecret: string
  supabaseAdminClient: SupabaseClient
  backendBaseUrl: string
}

type LeadRow = {
  id: string
  client_id: string
  name: string | null
  email: string | null
  phone: string | null
  need: string | null
  status: string
  source: string | null
  created_at: string
}

type ClientKnowledgeRow = {
  id: string
  client_id: string
  services_text: string | null
  pricing_text: string | null
  faqs_json: unknown[]
  hours_text: string | null
  contact_text: string | null
  updated_at: string
}

function asAuthenticatedRequest(request: unknown): AuthenticatedRequest {
  return request as AuthenticatedRequest
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

export function createDashboardRouter(options: DashboardRouterOptions): Router {
  const router = Router()

  router.use(authMiddleware(options.jwtSecret))

  router.get(
    '/summary',
    asyncHandler(async (request, response) => {
      const parsedQuery = dashboardSummaryQuerySchema.safeParse({
        limit_sessions: request.query.limit_sessions,
      })
      if (!parsedQuery.success) {
        return respondValidationError(parsedQuery.error, response)
      }

      const authRequest = asAuthenticatedRequest(request)
      const user = await loadUserById(options.supabaseAdminClient, authRequest.user.userId)
      if (!user) {
        throw new AppError('Unauthorized', 401)
      }

      const client = await ensureTenantOwnership(
        options.supabaseAdminClient,
        authRequest.user.userId,
        authRequest.user.clientId,
      )

      const subscription = await ensureSubscription(options.supabaseAdminClient, user.id)
      const plan = await loadPlanByCode(options.supabaseAdminClient, subscription.plan_code)
      const integrations = await loadUserChatbots(options.supabaseAdminClient, user.id)

      const [{ count: ticketCount, error: ticketError }, { data: recentMessages, error: messagesError }] =
        await Promise.all([
          options.supabaseAdminClient
            .from('tickets')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('status', 'open'),
          options.supabaseAdminClient
            .from('chatbot_messages')
            .select('id, user_id, chatbot_id, session_id, role, content, tokens_estimate, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(parsedQuery.data.limit_sessions),
        ])

      if (ticketError || messagesError) {
        throw new AppError('Failed to load dashboard summary', 500, ticketError ?? messagesError)
      }

      const groupedSessions = new Map<string, Array<Record<string, unknown>>>()
      for (const message of recentMessages ?? []) {
        const current = groupedSessions.get(message.session_id) ?? []
        current.push(message as unknown as Record<string, unknown>)
        groupedSessions.set(message.session_id, current)
      }

      const recentSessions = Array.from(groupedSessions.entries()).map(([sessionId, items]) => ({
        session_id: sessionId,
        messages: items,
      }))

      return response.json({
        ok: true,
        summary: {
          messages_used_this_period: subscription.message_count_in_period,
          total_messages_lifetime: subscription.total_message_count,
          plan: plan.code,
          integrations_used: integrations.length,
          integration_limit: resolveChatbotLimitForPlan(plan, user.role),
          tickets_open: ticketCount ?? 0,
        },
        recent_sessions: recentSessions,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        client,
        plan,
        subscription,
      })
    }),
  )

  router.get(
    '/metrics',
    asyncHandler(async (request, response) => {
      const authRequest = asAuthenticatedRequest(request)
      const user = await loadUserById(options.supabaseAdminClient, authRequest.user.userId)
      if (!user) {
        throw new AppError('Unauthorized', 401)
      }

      const usageCheck = await enforcePlanMessageLimit(options.supabaseAdminClient, user.id, user.role)
      const integrations = await loadUserChatbots(options.supabaseAdminClient, user.id)

      response.json({
        ok: true,
        metrics: {
          total_leads: 0,
          leads_last_7_days: 0,
          number_of_chats: usageCheck.subscription?.total_message_count ?? 0,
          integrations: integrations.length,
        },
      })
    }),
  )

  router.get(
    '/plan',
    asyncHandler(async (request, response) => {
      const authRequest = asAuthenticatedRequest(request)
      const user = await loadUserById(options.supabaseAdminClient, authRequest.user.userId)
      if (!user) {
        throw new AppError('Unauthorized', 401)
      }

      const subscription = await ensureSubscription(options.supabaseAdminClient, user.id)
      const plan = await loadPlanByCode(options.supabaseAdminClient, subscription.plan_code)

      response.json({
        ok: true,
        plan,
        subscription,
      })
    }),
  )

  router.post(
    '/profile',
    asyncHandler(async (request, response) => {
      const parsed = dashboardProfileSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const authRequest = asAuthenticatedRequest(request)

      const client = await ensureTenantOwnership(
        options.supabaseAdminClient,
        authRequest.user.userId,
        authRequest.user.clientId,
      )

      const { data, error } = await options.supabaseAdminClient
        .from('clients')
        .update({
          business_name: parsed.data.business_name,
          website_url: parsed.data.website_url?.trim() || null,
        })
        .eq('id', client.id)
        .select('id, user_id, business_name, website_url, plan, knowledge_base_text, created_at')
        .single()

      if (error || !data) {
        throw new AppError('Failed to update profile', 500, error)
      }

      await writeAuditLog({
        supabaseAdminClient: options.supabaseAdminClient,
        actorUserId: authRequest.user.userId,
        action: 'dashboard.profile.update',
      })

      response.json({ ok: true, client: data })
    }),
  )

  router.get(
    '/chatbots',
    asyncHandler(async (request, response) => {
      const authRequest = asAuthenticatedRequest(request)
      const chatbots = await loadUserChatbots(options.supabaseAdminClient, authRequest.user.userId)

      response.json({
        ok: true,
        chatbots,
      })
    }),
  )

  router.post(
    '/chatbots',
    asyncHandler(async (request, response) => {
      const parsed = dashboardChatbotCreateSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const authRequest = asAuthenticatedRequest(request)
      const user = await loadUserById(options.supabaseAdminClient, authRequest.user.userId)
      if (!user) {
        throw new AppError('Unauthorized', 401)
      }

      const client = await ensureClientForUser(options.supabaseAdminClient, {
        userId: user.id,
        businessName: 'Kufu Client',
        websiteUrl: null,
      })

      const usageCheck = await enforcePlanMessageLimit(options.supabaseAdminClient, user.id, user.role)
      const chatbotLimit = resolveChatbotLimitForPlan(usageCheck.plan, user.role)
      const existingChatbots = await loadUserChatbots(options.supabaseAdminClient, user.id)

      if (existingChatbots.length >= chatbotLimit) {
        throw new AppError(
          `Chatbot limit reached (${chatbotLimit}). Upgrade your plan to add more integrations.`,
          403,
        )
      }

      const createdDefaultChatbot = await ensureDefaultChatbot(options.supabaseAdminClient, {
        userId: user.id,
        clientId: client.id,
        websiteUrl: parsed.data.website_url?.trim() || client.website_url,
        businessName: parsed.data.name,
      })

      if (existingChatbots.length === 0) {
        response.status(201).json({ ok: true, chatbot: createdDefaultChatbot })
        return
      }

      const allowedDomains = buildAllowedDomains(parsed.data.website_url?.trim() || null, parsed.data.allowed_domains)

      const { data, error } = await options.supabaseAdminClient
        .from('chatbots')
        .insert({
          user_id: user.id,
          client_id: client.id,
          name: parsed.data.name,
          website_url: parsed.data.website_url?.trim() || null,
          allowed_domains: allowedDomains,
          widget_public_key: createWidgetPublicKey(),
          is_active: parsed.data.is_active ?? true,
          branding: {},
        })
        .select('id, user_id, client_id, name, website_url, allowed_domains, widget_public_key, is_active, branding, created_at, updated_at')
        .single()

      if (error || !data) {
        throw new AppError('Failed to create chatbot', 500, error)
      }

      await writeAuditLog({
        supabaseAdminClient: options.supabaseAdminClient,
        actorUserId: user.id,
        action: 'dashboard.chatbot.create',
        metadata: { chatbotId: data.id },
      })

      response.status(201).json({ ok: true, chatbot: data })
    }),
  )

  router.patch(
    '/chatbots/:id',
    asyncHandler(async (request, response) => {
      const parsed = dashboardChatbotUpdateSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const chatbotId = toSingleParam(request.params.id)
      if (!chatbotId) {
        throw new AppError('Chatbot id is required', 400)
      }

      const authRequest = asAuthenticatedRequest(request)
      const existingChatbot = await loadChatbotById(options.supabaseAdminClient, chatbotId)
      if (!existingChatbot || existingChatbot.user_id !== authRequest.user.userId) {
        throw new AppError('Chatbot not found', 404)
      }

      const payload: Record<string, unknown> = {}
      if (parsed.data.name !== undefined) {
        payload.name = parsed.data.name
      }
      if (parsed.data.website_url !== undefined) {
        payload.website_url = parsed.data.website_url?.trim() || null
      }
      if (parsed.data.is_active !== undefined) {
        payload.is_active = parsed.data.is_active
      }
      if (parsed.data.allowed_domains !== undefined || parsed.data.website_url !== undefined) {
        payload.allowed_domains = buildAllowedDomains(
          parsed.data.website_url?.trim() || existingChatbot.website_url,
          parsed.data.allowed_domains,
        )
      }
      payload.updated_at = new Date().toISOString()

      const { data, error } = await options.supabaseAdminClient
        .from('chatbots')
        .update(payload)
        .eq('id', chatbotId)
        .eq('user_id', authRequest.user.userId)
        .select('id, user_id, client_id, name, website_url, allowed_domains, widget_public_key, is_active, branding, created_at, updated_at')
        .single()

      if (error || !data) {
        throw new AppError('Failed to update chatbot', 500, error)
      }

      response.json({ ok: true, chatbot: data })
    }),
  )

  router.delete(
    '/chatbots/:id',
    asyncHandler(async (request, response) => {
      const chatbotId = toSingleParam(request.params.id)
      if (!chatbotId) {
        throw new AppError('Chatbot id is required', 400)
      }

      const authRequest = asAuthenticatedRequest(request)

      const { error } = await options.supabaseAdminClient
        .from('chatbots')
        .delete()
        .eq('id', chatbotId)
        .eq('user_id', authRequest.user.userId)

      if (error) {
        throw new AppError('Failed to delete chatbot', 500, error)
      }

      response.json({ ok: true })
    }),
  )

  router.get(
    '/embed/:chatbotId',
    asyncHandler(async (request, response) => {
      const authRequest = asAuthenticatedRequest(request)
      const chatbotId = toSingleParam(request.params.chatbotId)
      if (!chatbotId) {
        throw new AppError('chatbotId is required', 400)
      }

      const chatbot = await loadChatbotById(options.supabaseAdminClient, chatbotId)
      if (!chatbot || chatbot.user_id !== authRequest.user.userId) {
        throw new AppError('Chatbot not found', 404)
      }

      const snippet = `<script src="${options.backendBaseUrl}/widget/kufu.js?key=${encodeURIComponent(chatbot.widget_public_key)}" async></script>`

      response.json({
        ok: true,
        chatbot: {
          id: chatbot.id,
          name: chatbot.name,
          widget_public_key: chatbot.widget_public_key,
        },
        snippet,
      })
    }),
  )

  router.get(
    '/knowledge',
    asyncHandler(async (request, response) => {
      const authRequest = asAuthenticatedRequest(request)
      const client = await ensureTenantOwnership(
        options.supabaseAdminClient,
        authRequest.user.userId,
        authRequest.user.clientId,
      )

      const { data, error } = await options.supabaseAdminClient
        .from('client_knowledge')
        .select('id, client_id, services_text, pricing_text, faqs_json, hours_text, contact_text, updated_at')
        .eq('client_id', client.id)
        .maybeSingle<ClientKnowledgeRow>()

      if (error) {
        throw new AppError('Failed to load client knowledge', 500, error)
      }

      response.json({
        ok: true,
        knowledge: {
          client_id: client.id,
          services_text: data?.services_text ?? null,
          pricing_text: data?.pricing_text ?? null,
          faqs_json: data?.faqs_json ?? [],
          hours_text: data?.hours_text ?? null,
          contact_text: data?.contact_text ?? null,
          knowledge_base_text: client.knowledge_base_text ?? '',
          updated_at: data?.updated_at,
        },
      })
    }),
  )

  router.post(
    '/knowledge',
    asyncHandler(async (request, response) => {
      const parsed = dashboardKnowledgeSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const authRequest = asAuthenticatedRequest(request)
      const client = await ensureTenantOwnership(
        options.supabaseAdminClient,
        authRequest.user.userId,
        authRequest.user.clientId,
      )

      const knowledgePayload = {
        client_id: client.id,
        services_text: parsed.data.services_text ?? null,
        pricing_text: parsed.data.pricing_text ?? null,
        faqs_json: parsed.data.faqs_json ?? [],
        hours_text: parsed.data.hours_text ?? null,
        contact_text: parsed.data.contact_text ?? null,
        updated_at: new Date().toISOString(),
      }

      const { data: upsertedKnowledge, error: knowledgeError } = await options.supabaseAdminClient
        .from('client_knowledge')
        .upsert(knowledgePayload, { onConflict: 'client_id' })
        .select('id, client_id, services_text, pricing_text, faqs_json, hours_text, contact_text, updated_at')
        .single<ClientKnowledgeRow>()

      if (knowledgeError || !upsertedKnowledge) {
        throw new AppError('Failed to save knowledge', 500, knowledgeError)
      }

      const { data: updatedClient, error: clientUpdateError } = await options.supabaseAdminClient
        .from('clients')
        .update({ knowledge_base_text: parsed.data.knowledge_base_text ?? '' })
        .eq('id', client.id)
        .select('id, user_id, business_name, website_url, plan, knowledge_base_text, created_at')
        .single()

      if (clientUpdateError || !updatedClient) {
        throw new AppError('Failed to save primary knowledge text', 500, clientUpdateError)
      }

      response.json({
        ok: true,
        knowledge: {
          ...upsertedKnowledge,
          knowledge_base_text: updatedClient.knowledge_base_text ?? '',
        },
      })
    }),
  )

  router.get(
    '/tickets',
    asyncHandler(async (request, response) => {
      const authRequest = asAuthenticatedRequest(request)
      const { data, error } = await options.supabaseAdminClient
        .from('tickets')
        .select('id, user_id, subject, message, admin_response, status, created_at, updated_at')
        .eq('user_id', authRequest.user.userId)
        .order('created_at', { ascending: false })

      if (error) {
        throw new AppError('Failed to load tickets', 500, error)
      }

      response.json({ ok: true, tickets: data ?? [] })
    }),
  )

  router.post(
    '/tickets',
    asyncHandler(async (request, response) => {
      const parsed = dashboardTicketCreateSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const authRequest = asAuthenticatedRequest(request)
      const { data, error } = await options.supabaseAdminClient
        .from('tickets')
        .insert({
          user_id: authRequest.user.userId,
          subject: parsed.data.subject,
          message: parsed.data.message,
          status: 'open',
          updated_at: new Date().toISOString(),
        })
        .select('id, user_id, subject, message, admin_response, status, created_at, updated_at')
        .single()

      if (error || !data) {
        throw new AppError('Failed to create ticket', 500, error)
      }

      response.status(201).json({ ok: true, ticket: data })
    }),
  )

  router.patch(
    '/tickets/:id',
    asyncHandler(async (request, response) => {
      const parsed = dashboardTicketUpdateSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const ticketId = toSingleParam(request.params.id)
      if (!ticketId) {
        throw new AppError('Ticket id is required', 400)
      }

      const authRequest = asAuthenticatedRequest(request)
      if (parsed.data.status !== 'closed') {
        throw new AppError('Users can only close tickets', 403)
      }

      const { data, error } = await options.supabaseAdminClient
        .from('tickets')
        .update({
          status: 'closed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', ticketId)
        .eq('user_id', authRequest.user.userId)
        .select('id, user_id, subject, message, admin_response, status, created_at, updated_at')
        .single()

      if (error || !data) {
        throw new AppError('Failed to update ticket', 500, error)
      }

      response.json({ ok: true, ticket: data })
    }),
  )

  router.get(
    '/quotes',
    asyncHandler(async (request, response) => {
      const authRequest = asAuthenticatedRequest(request)

      const { data, error } = await options.supabaseAdminClient
        .from('custom_quotes')
        .select(
          'id, user_id, requested_plan, requested_chatbots, requested_unlimited_messages, notes, status, admin_response, created_at, updated_at',
        )
        .eq('user_id', authRequest.user.userId)
        .order('created_at', { ascending: false })

      if (error) {
        throw new AppError('Failed to load quote requests', 500, error)
      }

      response.json({ ok: true, quotes: data ?? [] })
    }),
  )

  router.post(
    '/quotes',
    asyncHandler(async (request, response) => {
      const parsed = dashboardQuoteCreateSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const authRequest = asAuthenticatedRequest(request)

      const { data: existingPending, error: existingError } = await options.supabaseAdminClient
        .from('custom_quotes')
        .select('id')
        .eq('user_id', authRequest.user.userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string }>()

      if (existingError) {
        throw new AppError('Failed to load existing quote request', 500, existingError)
      }

      let quoteResponse: unknown
      if (existingPending?.id) {
        const { data, error } = await options.supabaseAdminClient
          .from('custom_quotes')
          .update({
            requested_plan: parsed.data.requested_plan ?? null,
            requested_chatbots: parsed.data.requested_chatbots ?? null,
            requested_unlimited_messages: parsed.data.requested_unlimited_messages,
            notes: parsed.data.notes,
            status: 'pending',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingPending.id)
          .select(
            'id, user_id, requested_plan, requested_chatbots, requested_unlimited_messages, notes, status, admin_response, created_at, updated_at',
          )
          .single()

        if (error || !data) {
          throw new AppError('Failed to update quote request', 500, error)
        }

        quoteResponse = data
      } else {
        const { data, error } = await options.supabaseAdminClient
          .from('custom_quotes')
          .insert({
            user_id: authRequest.user.userId,
            requested_plan: parsed.data.requested_plan ?? null,
            requested_chatbots: parsed.data.requested_chatbots ?? null,
            requested_unlimited_messages: parsed.data.requested_unlimited_messages,
            notes: parsed.data.notes,
            status: 'pending',
            updated_at: new Date().toISOString(),
          })
          .select(
            'id, user_id, requested_plan, requested_chatbots, requested_unlimited_messages, notes, status, admin_response, created_at, updated_at',
          )
          .single()

        if (error || !data) {
          throw new AppError('Failed to create quote request', 500, error)
        }

        quoteResponse = data
      }

      await writeAuditLog({
        supabaseAdminClient: options.supabaseAdminClient,
        actorUserId: authRequest.user.userId,
        action: 'dashboard.quote.submit',
      })

      response.status(201).json({ ok: true, quote: quoteResponse })
    }),
  )

  router.get(
    '/leads',
    asyncHandler(async (request, response) => {
      const parsedQuery = dashboardLeadsQuerySchema.safeParse(request.query)
      if (!parsedQuery.success) {
        return respondValidationError(parsedQuery.error, response)
      }

      const authRequest = asAuthenticatedRequest(request)
      const client = await ensureTenantOwnership(
        options.supabaseAdminClient,
        authRequest.user.userId,
        authRequest.user.clientId,
      )

      const { limit, offset, status } = parsedQuery.data

      let query = options.supabaseAdminClient
        .from('leads')
        .select('id, client_id, name, email, phone, need, status, source, created_at', { count: 'exact' })
        .eq('client_id', client.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (status) {
        query = query.eq('status', status)
      }

      const { data, count, error } = await query.returns<LeadRow[]>()
      if (error) {
        throw new AppError('Failed to load leads', 500, error)
      }

      response.json({
        ok: true,
        leads: data ?? [],
        pagination: {
          limit,
          offset,
          total: count ?? 0,
        },
      })
    }),
  )

  router.patch(
    '/leads/:id',
    asyncHandler(async (request, response) => {
      const parsed = dashboardLeadStatusSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const leadId = toSingleParam(request.params.id)
      if (!leadId) {
        throw new AppError('Lead id is required', 400)
      }

      const authRequest = asAuthenticatedRequest(request)
      const client = await ensureTenantOwnership(
        options.supabaseAdminClient,
        authRequest.user.userId,
        authRequest.user.clientId,
      )

      const { data, error } = await options.supabaseAdminClient
        .from('leads')
        .update({ status: parsed.data.status })
        .eq('id', leadId)
        .eq('client_id', client.id)
        .select('id, client_id, name, email, phone, need, status, source, created_at')
        .single<LeadRow>()

      if (error || !data) {
        throw new AppError('Failed to update lead', 500, error)
      }

      response.json({ ok: true, lead: data })
    }),
  )

  return router
}


