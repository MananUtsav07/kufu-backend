import { Router, type Request, type Response } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'

import { authMiddleware, type AuthenticatedRequest } from '../lib/auth-middleware.js'
import { respondValidationError } from '../lib/http.js'
import {
  knowledgeUpsertSchema,
  leadsListQuerySchema,
  updateLeadStatusSchema,
  widgetConfigQuerySchema,
} from '../schemas/dashboard.js'

type DashboardRouterOptions = {
  jwtSecret: string
  supabaseAdminClient: SupabaseClient | null
}

type ClientOwnershipRow = {
  id: string
  user_id: string
  business_name: string
  website_url: string | null
  plan: string
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

async function ensureTenantOwnership(
  supabase: SupabaseClient,
  userId: string,
  clientId: string,
): Promise<ClientOwnershipRow | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, user_id, business_name, website_url, plan')
    .eq('id', clientId)
    .eq('user_id', userId)
    .maybeSingle<ClientOwnershipRow>()

  if (error) {
    throw new Error(`tenant_check_failed:${error.message}`)
  }

  return data ?? null
}

export function createDashboardRouter({
  jwtSecret,
  supabaseAdminClient,
}: DashboardRouterOptions): Router {
  const router = Router()

  router.use(authMiddleware(jwtSecret))

  router.get('/metrics', async (request: Request, response: Response) => {
    if (!supabaseAdminClient) {
      return response.status(500).json({
        ok: false,
        error: 'Server config missing: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY',
      })
    }

    const authRequest = request as AuthenticatedRequest
    const { userId, clientId } = authRequest.user

    try {
      const client = await ensureTenantOwnership(supabaseAdminClient, userId, clientId)
      if (!client) {
        return response.status(403).json({ ok: false, error: 'Forbidden' })
      }

      const now = new Date()
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const [{ count: totalLeads, error: totalError }, { count: recentLeads, error: recentError }] =
        await Promise.all([
          supabaseAdminClient
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('client_id', clientId),
          supabaseAdminClient
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('client_id', clientId)
            .gte('created_at', sevenDaysAgo),
        ])

      if (totalError || recentError) {
        console.error('[dashboard/metrics] count error:', totalError ?? recentError)
        return response.status(500).json({ ok: false, error: 'Failed to load metrics' })
      }

      return response.json({
        ok: true,
        metrics: {
          total_leads: totalLeads ?? 0,
          leads_last_7_days: recentLeads ?? 0,
          number_of_chats: 0,
        },
      })
    } catch (error) {
      console.error('[dashboard/metrics] unexpected error:', error)
      return response.status(500).json({ ok: false, error: 'Server error while loading metrics' })
    }
  })

  router.get('/leads', async (request: Request, response: Response) => {
    if (!supabaseAdminClient) {
      return response.status(500).json({
        ok: false,
        error: 'Server config missing: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY',
      })
    }

    const parsedQuery = leadsListQuerySchema.safeParse({
      limit: request.query.limit,
      offset: request.query.offset,
      status: request.query.status,
    })
    if (!parsedQuery.success) {
      return respondValidationError(parsedQuery.error, response)
    }

    const authRequest = request as AuthenticatedRequest
    const { userId, clientId } = authRequest.user

    try {
      const client = await ensureTenantOwnership(supabaseAdminClient, userId, clientId)
      if (!client) {
        return response.status(403).json({ ok: false, error: 'Forbidden' })
      }

      const { limit, offset, status } = parsedQuery.data
      let query = supabaseAdminClient
        .from('leads')
        .select('id, client_id, name, email, phone, need, status, source, created_at', { count: 'exact' })
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (status && status.trim().length > 0) {
        query = query.eq('status', status.trim())
      }

      const { data, count, error } = await query.returns<LeadRow[]>()
      if (error) {
        console.error('[dashboard/leads] load error:', error)
        return response.status(500).json({ ok: false, error: 'Failed to load leads' })
      }

      return response.json({
        ok: true,
        leads: data ?? [],
        pagination: {
          limit,
          offset,
          total: count ?? 0,
        },
      })
    } catch (error) {
      console.error('[dashboard/leads] unexpected error:', error)
      return response.status(500).json({ ok: false, error: 'Server error while loading leads' })
    }
  })

  router.patch('/leads/:id', async (request: Request, response: Response) => {
    if (!supabaseAdminClient) {
      return response.status(500).json({
        ok: false,
        error: 'Server config missing: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY',
      })
    }

    const parsedBody = updateLeadStatusSchema.safeParse(request.body)
    if (!parsedBody.success) {
      return respondValidationError(parsedBody.error, response)
    }

    const leadId = request.params.id
    if (!leadId) {
      return response.status(400).json({ ok: false, error: 'Lead id is required' })
    }

    const authRequest = request as AuthenticatedRequest
    const { userId, clientId } = authRequest.user

    try {
      const client = await ensureTenantOwnership(supabaseAdminClient, userId, clientId)
      if (!client) {
        return response.status(403).json({ ok: false, error: 'Forbidden' })
      }

      const { data, error } = await supabaseAdminClient
        .from('leads')
        .update({ status: parsedBody.data.status.trim() })
        .eq('id', leadId)
        .eq('client_id', clientId)
        .select('id, client_id, name, email, phone, need, status, source, created_at')
        .maybeSingle<LeadRow>()

      if (error) {
        console.error('[dashboard/leads/:id] update error:', error)
        return response.status(500).json({ ok: false, error: 'Failed to update lead' })
      }

      if (!data) {
        return response.status(404).json({ ok: false, error: 'Lead not found' })
      }

      return response.json({ ok: true, lead: data })
    } catch (error) {
      console.error('[dashboard/leads/:id] unexpected error:', error)
      return response.status(500).json({ ok: false, error: 'Server error while updating lead' })
    }
  })

  router.post('/knowledge', async (request: Request, response: Response) => {
    if (!supabaseAdminClient) {
      return response.status(500).json({
        ok: false,
        error: 'Server config missing: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY',
      })
    }

    const parsedBody = knowledgeUpsertSchema.safeParse(request.body)
    if (!parsedBody.success) {
      return respondValidationError(parsedBody.error, response)
    }

    const authRequest = request as AuthenticatedRequest
    const { userId, clientId } = authRequest.user

    try {
      const client = await ensureTenantOwnership(supabaseAdminClient, userId, clientId)
      if (!client) {
        return response.status(403).json({ ok: false, error: 'Forbidden' })
      }

      const payload = {
        client_id: clientId,
        services_text: parsedBody.data.services_text ?? null,
        pricing_text: parsedBody.data.pricing_text ?? null,
        faqs_json: parsedBody.data.faqs_json ?? [],
        hours_text: parsedBody.data.hours_text ?? null,
        contact_text: parsedBody.data.contact_text ?? null,
        updated_at: new Date().toISOString(),
      }

      const { data, error } = await supabaseAdminClient
        .from('client_knowledge')
        .upsert(payload, { onConflict: 'client_id' })
        .select('id, client_id, services_text, pricing_text, faqs_json, hours_text, contact_text, updated_at')
        .single<ClientKnowledgeRow>()

      if (error) {
        console.error('[dashboard/knowledge] upsert error:', error)
        return response.status(500).json({ ok: false, error: 'Failed to save knowledge' })
      }

      return response.json({ ok: true, knowledge: data })
    } catch (error) {
      console.error('[dashboard/knowledge] unexpected error:', error)
      return response.status(500).json({ ok: false, error: 'Server error while saving knowledge' })
    }
  })

  router.get('/knowledge', async (request: Request, response: Response) => {
    if (!supabaseAdminClient) {
      return response.status(500).json({
        ok: false,
        error: 'Server config missing: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY',
      })
    }

    const authRequest = request as AuthenticatedRequest
    const { userId, clientId } = authRequest.user

    try {
      const client = await ensureTenantOwnership(supabaseAdminClient, userId, clientId)
      if (!client) {
        return response.status(403).json({ ok: false, error: 'Forbidden' })
      }

      const { data, error } = await supabaseAdminClient
        .from('client_knowledge')
        .select('id, client_id, services_text, pricing_text, faqs_json, hours_text, contact_text, updated_at')
        .eq('client_id', clientId)
        .maybeSingle<ClientKnowledgeRow>()

      if (error) {
        console.error('[dashboard/knowledge] fetch error:', error)
        return response.status(500).json({ ok: false, error: 'Failed to load knowledge' })
      }

      return response.json({
        ok: true,
        knowledge:
          data ?? {
            client_id: clientId,
            services_text: null,
            pricing_text: null,
            faqs_json: [],
            hours_text: null,
            contact_text: null,
          },
      })
    } catch (error) {
      console.error('[dashboard/knowledge] unexpected error:', error)
      return response.status(500).json({ ok: false, error: 'Server error while loading knowledge' })
    }
  })

  router.get('/widget/config', async (request: Request, response: Response) => {
    if (!supabaseAdminClient) {
      return response.status(500).json({
        ok: false,
        error: 'Server config missing: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY',
      })
    }

    const parsedQuery = widgetConfigQuerySchema.safeParse({
      client_id: request.query.client_id,
    })
    if (!parsedQuery.success) {
      return respondValidationError(parsedQuery.error, response)
    }

    try {
      const { data: client, error: clientError } = await supabaseAdminClient
        .from('clients')
        .select('id, business_name, website_url, plan')
        .eq('id', parsedQuery.data.client_id)
        .maybeSingle<{ id: string; business_name: string; website_url: string | null; plan: string }>()

      if (clientError) {
        console.error('[dashboard/widget/config] client lookup error:', clientError)
        return response.status(500).json({ ok: false, error: 'Failed to load widget config' })
      }

      if (!client) {
        return response.status(404).json({ ok: false, error: 'Client not found' })
      }

      return response.json({
        ok: true,
        config: {
          client_id: client.id,
          business_name: client.business_name,
          website_url: client.website_url,
          plan: client.plan,
          greeting: `Hi, welcome to ${client.business_name}. How can we help?`,
          theme: 'dark',
        },
      })
    } catch (error) {
      console.error('[dashboard/widget/config] unexpected error:', error)
      return response.status(500).json({ ok: false, error: 'Server error while loading widget config' })
    }
  })

  return router
}
