import { Router } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'
import multer from 'multer'

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
  getUserPlanContext,
  loadPlanByCode,
  resolveChatbotLimitForPlan,
} from '../services/subscriptionService.js'
import {
  buildKbStoragePath,
  buildLogoStoragePath,
  createSignedStorageUrl,
  KB_DOCS_BUCKET,
  LOGO_BUCKET,
  removeObjectFromStorage,
  uploadBufferToStorage,
} from '../services/storageService.js'


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

type KbFileRow = {
  id: string
  chatbot_id: string
  user_id: string
  filename: string
  mime_type: string
  storage_path: string
  file_size: number
  created_at: string
}

const BYTES_IN_MB = 1024 * 1024
const MAX_LOGO_SIZE_BYTES = 2 * BYTES_IN_MB
const MAX_KB_FILE_SIZE_BYTES = 10 * BYTES_IN_MB

const ALLOWED_LOGO_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
])

const ALLOWED_KB_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function parseUploadedFile(request: AuthenticatedRequest): Express.Multer.File {
  const file = request.file
  if (!file) {
    throw new AppError('File is required. Use multipart/form-data field "file".', 400)
  }

  return file
}

function assertStarterPlusUploadAccess(params: {
  role: AuthenticatedRequest['user']['role']
  planCode: string
}) {
  if (params.role === 'admin') {
    return
  }

  const starterPlusPlans = new Set(['starter', 'pro', 'business'])
  if (!starterPlusPlans.has(params.planCode)) {
    throw new AppError('Upgrade required', 403)
  }
}

export function createDashboardRouter(options: DashboardRouterOptions): Router {
  const router = Router()
  const uploadParser = multer({ storage: multer.memoryStorage() })

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
          logo_path: null,
          logo_updated_at: null,
          is_active: parsed.data.is_active ?? true,
          branding: {},
        })
        .select(
          'id, user_id, client_id, name, website_url, allowed_domains, widget_public_key, logo_path, logo_updated_at, is_active, branding, created_at, updated_at',
        )
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
      const isOwner = existingChatbot?.user_id === authRequest.user.userId
      const canManageChatbot = authRequest.user.role === 'admin' || isOwner
      if (!existingChatbot || !canManageChatbot) {
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

      let updateQuery = options.supabaseAdminClient
        .from('chatbots')
        .update(payload)
        .eq('id', chatbotId)
        .select(
          'id, user_id, client_id, name, website_url, allowed_domains, widget_public_key, logo_path, logo_updated_at, is_active, branding, created_at, updated_at',
        )

      if (authRequest.user.role !== 'admin') {
        updateQuery = updateQuery.eq('user_id', authRequest.user.userId)
      }

      const { data, error } = await updateQuery.single()

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
      const chatbot = await loadChatbotById(options.supabaseAdminClient, chatbotId)
      const isOwner = chatbot?.user_id === authRequest.user.userId
      const canManageChatbot = authRequest.user.role === 'admin' || isOwner
      if (!chatbot || !canManageChatbot) {
        throw new AppError('Chatbot not found', 404)
      }

      if (chatbot.logo_path) {
        await removeObjectFromStorage({
          supabaseAdminClient: options.supabaseAdminClient,
          bucket: LOGO_BUCKET,
          storagePath: chatbot.logo_path,
        })
      }

      let deleteQuery = options.supabaseAdminClient.from('chatbots').delete().eq('id', chatbotId)
      if (authRequest.user.role !== 'admin') {
        deleteQuery = deleteQuery.eq('user_id', authRequest.user.userId)
      }

      const { error } = await deleteQuery

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

      const backendBase = trimTrailingSlash(options.backendBaseUrl)
      const snippet = `<script src="${backendBase}/widget/kufu.js?key=${encodeURIComponent(chatbot.widget_public_key)}" async></script>`

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
    '/chatbots/:id/logo',
    asyncHandler(async (request, response) => {
      const chatbotId = toSingleParam(request.params.id)
      if (!chatbotId) {
        throw new AppError('Chatbot id is required', 400)
      }

      const authRequest = asAuthenticatedRequest(request)
      const chatbot = await loadChatbotById(options.supabaseAdminClient, chatbotId)
      const isOwner = chatbot?.user_id === authRequest.user.userId
      const canManageChatbot = authRequest.user.role === 'admin' || isOwner
      if (!chatbot || !canManageChatbot) {
        throw new AppError('Chatbot not found', 404)
      }

      const logoUrl = await createSignedStorageUrl({
        supabaseAdminClient: options.supabaseAdminClient,
        bucket: LOGO_BUCKET,
        storagePath: chatbot.logo_path,
        expiresInSeconds: 3600,
      })

      response.json({
        ok: true,
        logoUrl,
      })
    }),
  )

  router.post(
    '/chatbots/:id/logo',
    uploadParser.single('file'),
    asyncHandler(async (request, response) => {
      const chatbotId = toSingleParam(request.params.id)
      if (!chatbotId) {
        throw new AppError('Chatbot id is required', 400)
      }

      const authRequest = asAuthenticatedRequest(request)
      const chatbot = await loadChatbotById(options.supabaseAdminClient, chatbotId)
      const isOwner = chatbot?.user_id === authRequest.user.userId
      const canManageChatbot = authRequest.user.role === 'admin' || isOwner
      if (!chatbot || !canManageChatbot) {
        throw new AppError('Chatbot not found', 404)
      }

      if (authRequest.user.role !== 'admin') {
        const planContext = await getUserPlanContext(
          options.supabaseAdminClient,
          authRequest.user.userId,
          authRequest.user.role,
        )
        assertStarterPlusUploadAccess({
          role: authRequest.user.role,
          planCode: planContext.planCode,
        })
      }

      const parsedFile = parseUploadedFile(authRequest)

      if (!ALLOWED_LOGO_MIME_TYPES.has(parsedFile.mimetype)) {
        throw new AppError('Invalid logo file type. Use PNG, JPG, WEBP, or SVG.', 400)
      }

      if (parsedFile.size > MAX_LOGO_SIZE_BYTES) {
        throw new AppError('Logo file too large. Max allowed size is 2MB.', 400)
      }

      if (chatbot.logo_path) {
        await removeObjectFromStorage({
          supabaseAdminClient: options.supabaseAdminClient,
          bucket: LOGO_BUCKET,
          storagePath: chatbot.logo_path,
        })
      }

      const storagePath = buildLogoStoragePath({
        userId: chatbot.user_id,
        chatbotId: chatbot.id,
        originalName: parsedFile.originalname,
      })

      await uploadBufferToStorage({
        supabaseAdminClient: options.supabaseAdminClient,
        bucket: LOGO_BUCKET,
        storagePath,
        fileBuffer: parsedFile.buffer,
        contentType: parsedFile.mimetype,
      })

      const { data: updatedChatbot, error: updateError } = await options.supabaseAdminClient
        .from('chatbots')
        .update({
          logo_path: storagePath,
          logo_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', chatbot.id)
        .select(
          'id, user_id, client_id, name, website_url, allowed_domains, widget_public_key, logo_path, logo_updated_at, is_active, branding, created_at, updated_at',
        )
        .single()

      if (updateError || !updatedChatbot) {
        throw new AppError('Failed to save chatbot logo', 500, updateError)
      }

      const logoUrl = await createSignedStorageUrl({
        supabaseAdminClient: options.supabaseAdminClient,
        bucket: LOGO_BUCKET,
        storagePath: updatedChatbot.logo_path,
        expiresInSeconds: 3600,
      })

      response.status(201).json({
        ok: true,
        logoUrl,
      })
    }),
  )

  router.delete(
    '/chatbots/:id/logo',
    asyncHandler(async (request, response) => {
      const chatbotId = toSingleParam(request.params.id)
      if (!chatbotId) {
        throw new AppError('Chatbot id is required', 400)
      }

      const authRequest = asAuthenticatedRequest(request)
      const chatbot = await loadChatbotById(options.supabaseAdminClient, chatbotId)
      const isOwner = chatbot?.user_id === authRequest.user.userId
      const canManageChatbot = authRequest.user.role === 'admin' || isOwner
      if (!chatbot || !canManageChatbot) {
        throw new AppError('Chatbot not found', 404)
      }

      if (authRequest.user.role !== 'admin') {
        const planContext = await getUserPlanContext(
          options.supabaseAdminClient,
          authRequest.user.userId,
          authRequest.user.role,
        )
        assertStarterPlusUploadAccess({
          role: authRequest.user.role,
          planCode: planContext.planCode,
        })
      }

      if (chatbot.logo_path) {
        await removeObjectFromStorage({
          supabaseAdminClient: options.supabaseAdminClient,
          bucket: LOGO_BUCKET,
          storagePath: chatbot.logo_path,
        })
      }

      const { error: updateError } = await options.supabaseAdminClient
        .from('chatbots')
        .update({
          logo_path: null,
          logo_updated_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', chatbot.id)

      if (updateError) {
        throw new AppError('Failed to remove chatbot logo', 500, updateError)
      }

      response.json({ ok: true })
    }),
  )

  router.get(
    '/chatbots/:id/kb-files',
    asyncHandler(async (request, response) => {
      const chatbotId = toSingleParam(request.params.id)
      if (!chatbotId) {
        throw new AppError('Chatbot id is required', 400)
      }

      const authRequest = asAuthenticatedRequest(request)
      const chatbot = await loadChatbotById(options.supabaseAdminClient, chatbotId)
      const isOwner = chatbot?.user_id === authRequest.user.userId
      const canManageChatbot = authRequest.user.role === 'admin' || isOwner
      if (!chatbot || !canManageChatbot) {
        throw new AppError('Chatbot not found', 404)
      }

      const { data, error } = await options.supabaseAdminClient
        .from('kb_files')
        .select('id, chatbot_id, user_id, filename, mime_type, storage_path, file_size, created_at')
        .eq('chatbot_id', chatbot.id)
        .order('created_at', { ascending: false })
        .returns<KbFileRow[]>()

      if (error) {
        throw new AppError('Failed to load knowledge files', 500, error)
      }

      response.json({
        ok: true,
        files: data ?? [],
      })
    }),
  )

  router.post(
    '/chatbots/:id/kb-files',
    uploadParser.single('file'),
    asyncHandler(async (request, response) => {
      const chatbotId = toSingleParam(request.params.id)
      if (!chatbotId) {
        throw new AppError('Chatbot id is required', 400)
      }

      const authRequest = asAuthenticatedRequest(request)
      const chatbot = await loadChatbotById(options.supabaseAdminClient, chatbotId)
      const isOwner = chatbot?.user_id === authRequest.user.userId
      const canManageChatbot = authRequest.user.role === 'admin' || isOwner
      if (!chatbot || !canManageChatbot) {
        throw new AppError('Chatbot not found', 404)
      }

      if (authRequest.user.role !== 'admin') {
        const planContext = await getUserPlanContext(
          options.supabaseAdminClient,
          authRequest.user.userId,
          authRequest.user.role,
        )
        assertStarterPlusUploadAccess({
          role: authRequest.user.role,
          planCode: planContext.planCode,
        })
      }

      const parsedFile = parseUploadedFile(authRequest)

      if (!ALLOWED_KB_MIME_TYPES.has(parsedFile.mimetype)) {
        throw new AppError('Invalid file type. Only PDF, DOC, and DOCX are allowed.', 400)
      }

      if (parsedFile.size > MAX_KB_FILE_SIZE_BYTES) {
        throw new AppError('File too large. Max allowed size is 10MB.', 400)
      }

      const storagePath = buildKbStoragePath({
        userId: chatbot.user_id,
        chatbotId: chatbot.id,
        originalName: parsedFile.originalname,
      })

      await uploadBufferToStorage({
        supabaseAdminClient: options.supabaseAdminClient,
        bucket: KB_DOCS_BUCKET,
        storagePath,
        fileBuffer: parsedFile.buffer,
        contentType: parsedFile.mimetype,
      })

      const { data: insertedFile, error: insertError } = await options.supabaseAdminClient
        .from('kb_files')
        .insert({
          chatbot_id: chatbot.id,
          user_id: chatbot.user_id,
          filename: parsedFile.originalname,
          mime_type: parsedFile.mimetype,
          storage_path: storagePath,
          file_size: parsedFile.size,
        })
        .select('id, chatbot_id, user_id, filename, mime_type, storage_path, file_size, created_at')
        .single<KbFileRow>()

      if (insertError || !insertedFile) {
        throw new AppError('Failed to save knowledge file metadata', 500, insertError)
      }

      response.status(201).json({
        ok: true,
        file: {
          id: insertedFile.id,
          filename: insertedFile.filename,
          mime_type: insertedFile.mime_type,
          file_size: insertedFile.file_size,
          created_at: insertedFile.created_at,
        },
      })
    }),
  )

  router.delete(
    '/kb-files/:fileId',
    asyncHandler(async (request, response) => {
      const fileId = toSingleParam(request.params.fileId)
      if (!fileId) {
        throw new AppError('File id is required', 400)
      }

      const authRequest = asAuthenticatedRequest(request)
      const { data: kbFile, error: kbFileError } = await options.supabaseAdminClient
        .from('kb_files')
        .select('id, chatbot_id, user_id, filename, mime_type, storage_path, file_size, created_at')
        .eq('id', fileId)
        .maybeSingle<KbFileRow>()

      if (kbFileError) {
        throw new AppError('Failed to load knowledge file', 500, kbFileError)
      }

      if (!kbFile) {
        throw new AppError('Knowledge file not found', 404)
      }

      const isOwner = kbFile.user_id === authRequest.user.userId
      const canDelete = authRequest.user.role === 'admin' || isOwner
      if (!canDelete) {
        throw new AppError('Knowledge file not found', 404)
      }

      await removeObjectFromStorage({
        supabaseAdminClient: options.supabaseAdminClient,
        bucket: KB_DOCS_BUCKET,
        storagePath: kbFile.storage_path,
      })

      const { error: deleteError } = await options.supabaseAdminClient.from('kb_files').delete().eq('id', kbFile.id)
      if (deleteError) {
        throw new AppError('Failed to delete knowledge file metadata', 500, deleteError)
      }

      response.json({ ok: true })
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



