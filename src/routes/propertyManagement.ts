import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import type OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { rateLimit } from 'express-rate-limit'

import { authMiddleware, type AuthenticatedRequest } from '../lib/auth-middleware.js'
import { tenantAuthMiddleware, type TenantAuthenticatedRequest } from '../lib/property-management-auth.js'
import { asyncHandler, AppError } from '../lib/errors.js'
import { respondValidationError } from '../lib/http.js'
import { signTenantSessionToken } from '../lib/tenant-session.js'
import type { Mailer } from './auth.js'
import {
  ownerCreateTenantSchema,
  ownerTicketStatusUpdateSchema,
  paginationQuerySchema,
  processRemindersSchema,
  tenantChatSchema,
  tenantCreateTicketSchema,
  tenantLoginSchema,
} from '../schemas/propertyManagement.js'
import { normalizeEmail } from '../lib/validation.js'
import {
  ensurePropertyOwnerProfile,
  createOwnerNotification,
  createProperty,
  createPropertyTenant,
  createTenantSupportTicket,
  createTemporaryTenantPassword,
  createTenantAccessId,
  createTenantDashboardSession,
  insertTenantChatMessage,
  listOwnerNotifications,
  loadOwnerTenants,
  listOwnerTickets,
  listRentRemindersByTenant,
  listTenantMessages,
  listTenantTickets,
  loadTenantDashboardSummary,
  loadOwnerDashboardSummary,
  loadOwnerPropertyById,
  loadOwnerTenantDetail,
  loadOwnerTenantById,
  loadPropertyOwnerByUserId,
  loadTenantByAccessId,
  loadTenantSummaryContext,
  scheduleRentRemindersForTenant,
  processPendingRentReminders,
  updateOwnerTicketStatus,
  type PropertyOwnerRow,
} from '../services/propertyManagementService.js'
import {
  loadClientByUserId,
  loadUserById,
} from '../services/tenantService.js'
import { buildTenantWhatsAppSupportStub } from '../services/propertyWhatsAppService.js'

type PropertyManagementRouterOptions = {
  jwtSecret: string
  supabaseAdminClient: SupabaseClient
  openAiApiKey: string
  openAiModel: string
  openAiClient: OpenAI | null
  mailer: Mailer
}

type TenantChatIntent = 'maintenance' | 'payment' | 'renewal' | 'general' | 'escalate'

function toAuthenticatedRequest(request: unknown): AuthenticatedRequest {
  return request as AuthenticatedRequest
}

function toTenantAuthenticatedRequest(request: unknown): TenantAuthenticatedRequest {
  return request as TenantAuthenticatedRequest
}

function parseNumeric(input: number | string): number {
  if (typeof input === 'number') {
    return input
  }
  const parsed = Number.parseFloat(input)
  if (!Number.isFinite(parsed)) {
    throw new AppError('Invalid rent amount', 400)
  }
  return parsed
}

function sanitizeModelText(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.replace(/```json/gi, '').replace(/```/g, '').trim()
}

function classifyIntentFromText(text: string): TenantChatIntent {
  const value = text.toLowerCase()

  if (/(human|agent|owner|manager|urgent|lawyer|complaint|escalat)/.test(value)) {
    return 'escalate'
  }
  if (/(repair|maint|leak|plumb|electric|water|broken|ac|aircon|mold|painting)/.test(value)) {
    return 'maintenance'
  }
  if (/(rent|payment|due|receipt|deposit|late fee|invoice|upi)/.test(value)) {
    return 'payment'
  }
  if (/(renew|lease|contract|extend|move out|vacate|notice)/.test(value)) {
    return 'renewal'
  }

  return 'general'
}

async function generateTenantChatReply(args: {
  openAiApiKey: string
  openAiModel: string
  openAiClient: OpenAI | null
  tenantName: string
  propertyName: string
  message: string
}): Promise<{ intent: TenantChatIntent; reply: string; escalate: boolean }> {
  const fallbackIntent = classifyIntentFromText(args.message)
  const fallbackEscalate = fallbackIntent === 'escalate'

  if (!args.openAiApiKey || !args.openAiClient) {
    return {
      intent: fallbackIntent,
      reply: fallbackEscalate
        ? 'Let me connect you with our team.'
        : 'Thanks for your message. Our support assistant has logged it and will help shortly.',
      escalate: fallbackEscalate,
    }
  }

  const systemPrompt = [
    'You are the tenant support AI assistant for a property management company.',
    'Classify intent as one of: maintenance, payment, renewal, general, escalate.',
    'Respond in concise practical language.',
    'If tenant asks for human help, legal threat, emergency, harassment, or you are uncertain, set intent to escalate.',
    'Return strict JSON: {"intent":"...","reply":"...","escalate":true|false}.',
  ].join(' ')

  const completion = await args.openAiClient.chat.completions.create({
    model: args.openAiModel,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          `Tenant: ${args.tenantName}`,
          `Property: ${args.propertyName}`,
          `Message: ${args.message}`,
        ].join('\n'),
      },
    ],
  })

  const raw = sanitizeModelText(completion.choices?.[0]?.message?.content ?? '')
  try {
    const parsed = JSON.parse(raw) as {
      intent?: string
      reply?: string
      escalate?: boolean
    }

    const intent: TenantChatIntent =
      parsed.intent === 'maintenance' ||
      parsed.intent === 'payment' ||
      parsed.intent === 'renewal' ||
      parsed.intent === 'general' ||
      parsed.intent === 'escalate'
        ? parsed.intent
        : fallbackIntent

    const escalate = Boolean(parsed.escalate) || intent === 'escalate'
    const reply =
      typeof parsed.reply === 'string' && parsed.reply.trim().length > 0
        ? parsed.reply.trim()
        : escalate
          ? 'Let me connect you with our team.'
          : 'Thanks for your message. Our support assistant has logged it and will help shortly.'

    return {
      intent,
      reply,
      escalate,
    }
  } catch {
    return {
      intent: fallbackIntent,
      reply: fallbackEscalate
        ? 'Let me connect you with our team.'
        : "Thanks for the details. I've logged this and our team will respond soon.",
      escalate: fallbackEscalate,
    }
  }
}

async function resolveOwnerContext(args: {
  supabaseAdminClient: SupabaseClient
  userId: string
}): Promise<PropertyOwnerRow> {
  const existingOwner = await loadPropertyOwnerByUserId(args.supabaseAdminClient, args.userId)
  if (existingOwner) {
    return existingOwner
  }

  const user = await loadUserById(args.supabaseAdminClient, args.userId)
  if (!user) {
    throw new AppError('Unauthorized', 401)
  }

  const client = await loadClientByUserId(args.supabaseAdminClient, args.userId)
  const companyName = client?.business_name?.trim() || `${user.email.split('@')[0]} Properties`
  const supportEmail = user.email

  return ensurePropertyOwnerProfile({
    supabaseAdminClient: args.supabaseAdminClient,
    userId: args.userId,
    companyName,
    supportEmail,
    supportWhatsApp: null,
  })
}

function redactTenantSensitiveFields<T extends { password_hash?: string }>(tenant: T): Omit<T, 'password_hash'> {
  const clone = { ...tenant }
  delete clone.password_hash
  return clone
}

function buildTenantJwtExpiry(): { expiresAtIso: string; expiresInMs: number } {
  const expiresInMs = 7 * 24 * 60 * 60 * 1000
  return {
    expiresAtIso: new Date(Date.now() + expiresInMs).toISOString(),
    expiresInMs,
  }
}

export function createPropertyManagementRouter(options: PropertyManagementRouterOptions): Router {
  const router = Router()

  const ownerGuard = authMiddleware(options.jwtSecret)
  const tenantGuard = tenantAuthMiddleware(options.jwtSecret, options.supabaseAdminClient)

  const tenantAuthRateLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      ok: false,
      error: 'Too many tenant login attempts. Please try again later.',
    },
  })

  router.post(
    '/owner/tenants',
    ownerGuard,
    asyncHandler(async (request, response) => {
      const parsed = ownerCreateTenantSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const authRequest = toAuthenticatedRequest(request)
      const owner = await resolveOwnerContext({
        supabaseAdminClient: options.supabaseAdminClient,
        userId: authRequest.user.userId,
      })

      let propertyId = parsed.data.property_id ?? null
      if (propertyId) {
        const existingProperty = await loadOwnerPropertyById(
          options.supabaseAdminClient,
          owner.id,
          propertyId,
        )
        if (!existingProperty) {
          throw new AppError('Property not found for owner', 404)
        }
      } else {
        if (!parsed.data.property_name || !parsed.data.address) {
          throw new AppError(
            'property_name and address are required when property_id is not provided',
            400,
          )
        }

        const property = await createProperty({
          supabaseAdminClient: options.supabaseAdminClient,
          ownerId: owner.id,
          propertyName: parsed.data.property_name,
          address: parsed.data.address,
          unitNumber: parsed.data.unit_number,
        })
        propertyId = property.id
      }

      const tenantAccessId = createTenantAccessId()
      const generatedPassword = parsed.data.password?.trim() || createTemporaryTenantPassword()
      const passwordHash = await bcrypt.hash(generatedPassword, 12)

      const tenant = await createPropertyTenant(options.supabaseAdminClient, {
        ownerId: owner.id,
        propertyId,
        fullName: parsed.data.full_name,
        email: parsed.data.email,
        phone: parsed.data.phone?.trim() || null,
        tenantAccessId,
        passwordHash,
        leaseStartDate: parsed.data.lease_start_date ?? null,
        leaseEndDate: parsed.data.lease_end_date ?? null,
        monthlyRent: parseNumeric(parsed.data.monthly_rent),
        paymentDueDay: parsed.data.payment_due_day,
        paymentStatus: parsed.data.payment_status ?? 'pending',
        status: parsed.data.status ?? 'active',
      })

      await scheduleRentRemindersForTenant({
        supabaseAdminClient: options.supabaseAdminClient,
        tenantId: tenant.id,
        ownerId: owner.id,
        paymentDueDay: tenant.payment_due_day,
      })

      response.status(201).json({
        ok: true,
        tenant: redactTenantSensitiveFields(tenant),
        credentials: {
          tenant_access_id: tenant.tenant_access_id,
          password: generatedPassword,
          generated: !parsed.data.password,
        },
      })
    }),
  )

  router.get(
    '/owner/tenants',
    ownerGuard,
    asyncHandler(async (request, response) => {
      const authRequest = toAuthenticatedRequest(request)
      const owner = await resolveOwnerContext({
        supabaseAdminClient: options.supabaseAdminClient,
        userId: authRequest.user.userId,
      })

      const tenants = await loadOwnerTenants(options.supabaseAdminClient, owner.id)
      response.json({
        ok: true,
        tenants,
      })
    }),
  )

  router.get(
    '/owner/tenants/:tenantId',
    ownerGuard,
    asyncHandler(async (request, response) => {
      const authRequest = toAuthenticatedRequest(request)
      const owner = await resolveOwnerContext({
        supabaseAdminClient: options.supabaseAdminClient,
        userId: authRequest.user.userId,
      })

      const tenantId = String(request.params.tenantId)
      const detail = await loadOwnerTenantDetail(
        options.supabaseAdminClient,
        owner.id,
        tenantId,
      )

      if (!detail) {
        throw new AppError('Tenant not found', 404)
      }

      response.json({
        ok: true,
        detail,
      })
    }),
  )

  router.get(
    '/owner/tickets',
    ownerGuard,
    asyncHandler(async (request, response) => {
      const authRequest = toAuthenticatedRequest(request)
      const owner = await resolveOwnerContext({
        supabaseAdminClient: options.supabaseAdminClient,
        userId: authRequest.user.userId,
      })

      const tickets = await listOwnerTickets(options.supabaseAdminClient, owner.id)
      response.json({
        ok: true,
        tickets,
      })
    }),
  )

  router.patch(
    '/owner/tickets/:ticketId',
    ownerGuard,
    asyncHandler(async (request, response) => {
      const parsed = ownerTicketStatusUpdateSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const authRequest = toAuthenticatedRequest(request)
      const owner = await resolveOwnerContext({
        supabaseAdminClient: options.supabaseAdminClient,
        userId: authRequest.user.userId,
      })

      const ticketId = String(request.params.ticketId)
      const ticket = await updateOwnerTicketStatus({
        supabaseAdminClient: options.supabaseAdminClient,
        ownerId: owner.id,
        ticketId,
        status: parsed.data.status,
      })

      response.json({
        ok: true,
        ticket,
      })
    }),
  )

  router.get(
    '/owner/notifications',
    ownerGuard,
    asyncHandler(async (request, response) => {
      const authRequest = toAuthenticatedRequest(request)
      const owner = await resolveOwnerContext({
        supabaseAdminClient: options.supabaseAdminClient,
        userId: authRequest.user.userId,
      })

      const notifications = await listOwnerNotifications(options.supabaseAdminClient, owner.id)
      response.json({
        ok: true,
        notifications,
      })
    }),
  )

  router.get(
    '/owner/dashboard-summary',
    ownerGuard,
    asyncHandler(async (request, response) => {
      const authRequest = toAuthenticatedRequest(request)
      const owner = await resolveOwnerContext({
        supabaseAdminClient: options.supabaseAdminClient,
        userId: authRequest.user.userId,
      })

      const summary = await loadOwnerDashboardSummary(options.supabaseAdminClient, owner.id)
      response.json({
        ok: true,
        summary,
      })
    }),
  )

  router.post(
    '/tenant/login',
    tenantAuthRateLimiter,
    asyncHandler(async (request, response) => {
      const parsed = tenantLoginSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const tenant = await loadTenantByAccessId(
        options.supabaseAdminClient,
        parsed.data.tenant_access_id,
      )

      if (!tenant || tenant.status !== 'active') {
        throw new AppError('Invalid tenant credentials', 401)
      }

      if (parsed.data.email && normalizeEmail(parsed.data.email) !== normalizeEmail(tenant.email)) {
        throw new AppError('Invalid tenant credentials', 401)
      }

      const passwordMatches = await bcrypt.compare(parsed.data.password, tenant.password_hash)
      if (!passwordMatches) {
        throw new AppError('Invalid tenant credentials', 401)
      }

      const sessionId = randomBytes(18).toString('hex')
      const { expiresAtIso } = buildTenantJwtExpiry()
      const token = signTenantSessionToken(
        {
          tenantId: tenant.id,
          ownerId: tenant.owner_id,
          sessionId,
        },
        options.jwtSecret,
      )

      await createTenantDashboardSession({
        supabaseAdminClient: options.supabaseAdminClient,
        tenantId: tenant.id,
        token,
        expiresAt: expiresAtIso,
      })

      const context = await loadTenantSummaryContext(options.supabaseAdminClient, tenant.id)
      if (!context) {
        throw new AppError('Tenant profile not found', 404)
      }

      response.json({
        ok: true,
        token,
        tenant: context.tenant,
        property: context.property,
        owner: context.owner,
      })
    }),
  )

  router.get(
    '/tenant/me',
    tenantGuard,
    asyncHandler(async (request, response) => {
      const tenantRequest = toTenantAuthenticatedRequest(request)
      const context = await loadTenantSummaryContext(
        options.supabaseAdminClient,
        tenantRequest.tenantUser.tenantId,
      )
      if (!context) {
        throw new AppError('Tenant profile not found', 404)
      }

      response.json({
        ok: true,
        tenant: context.tenant,
        property: context.property,
        owner: context.owner,
      })
    }),
  )

  router.get(
    '/tenant/dashboard-summary',
    tenantGuard,
    asyncHandler(async (request, response) => {
      const tenantRequest = toTenantAuthenticatedRequest(request)
      const context = await loadTenantSummaryContext(
        options.supabaseAdminClient,
        tenantRequest.tenantUser.tenantId,
      )
      if (!context) {
        throw new AppError('Tenant profile not found', 404)
      }

      const summary = await loadTenantDashboardSummary(
        options.supabaseAdminClient,
        tenantRequest.tenantUser.tenantId,
      )

      response.json({
        ok: true,
        summary,
        tenant: context.tenant,
        property: context.property,
      })
    }),
  )

  router.post(
    '/tenant/tickets',
    tenantGuard,
    asyncHandler(async (request, response) => {
      const parsed = tenantCreateTicketSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const tenantRequest = toTenantAuthenticatedRequest(request)
      const context = await loadTenantSummaryContext(
        options.supabaseAdminClient,
        tenantRequest.tenantUser.tenantId,
      )
      if (!context) {
        throw new AppError('Tenant profile not found', 404)
      }

      const ticket = await createTenantSupportTicket({
        supabaseAdminClient: options.supabaseAdminClient,
        tenantId: context.tenant.id,
        ownerId: context.owner.id,
        subject: parsed.data.subject,
        message: parsed.data.message,
      })

      await createOwnerNotification({
        supabaseAdminClient: options.supabaseAdminClient,
        ownerId: context.owner.id,
        tenantId: context.tenant.id,
        notificationType: 'ticket_created',
        title: `New ticket from ${context.tenant.full_name}`,
        message: parsed.data.subject,
      })

      if (options.mailer) {
        options.mailer
          .sendPropertyTicketNotification({
            to: context.owner.support_email,
            submittedAtIso: new Date().toISOString(),
            ownerCompanyName: context.owner.company_name,
            tenantName: context.tenant.full_name,
            tenantAccessId: context.tenant.tenant_access_id,
            subject: parsed.data.subject,
            message: parsed.data.message,
          })
          .catch((error) => {
            console.error(
              JSON.stringify({
                level: 'error',
                type: 'property_ticket_email_failed',
                message: error instanceof Error ? error.message : 'Unknown property ticket email error',
              }),
            )
          })
      }

      response.status(201).json({
        ok: true,
        ticket,
      })
    }),
  )

  router.get(
    '/tenant/tickets',
    tenantGuard,
    asyncHandler(async (request, response) => {
      const tenantRequest = toTenantAuthenticatedRequest(request)
      const tickets = await listTenantTickets(
        options.supabaseAdminClient,
        tenantRequest.tenantUser.tenantId,
      )

      response.json({
        ok: true,
        tickets,
      })
    }),
  )

  router.get(
    '/tenant/messages',
    tenantGuard,
    asyncHandler(async (request, response) => {
      const tenantRequest = toTenantAuthenticatedRequest(request)
      const messages = await listTenantMessages(
        options.supabaseAdminClient,
        tenantRequest.tenantUser.tenantId,
      )

      response.json({
        ok: true,
        messages,
      })
    }),
  )

  router.post(
    '/tenant/chat',
    tenantGuard,
    asyncHandler(async (request, response) => {
      const parsed = tenantChatSchema.safeParse(request.body)
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const tenantRequest = toTenantAuthenticatedRequest(request)
      const context = await loadTenantSummaryContext(
        options.supabaseAdminClient,
        tenantRequest.tenantUser.tenantId,
      )
      if (!context) {
        throw new AppError('Tenant profile not found', 404)
      }

      const generated = await generateTenantChatReply({
        openAiApiKey: options.openAiApiKey,
        openAiModel: options.openAiModel,
        openAiClient: options.openAiClient,
        tenantName: context.tenant.full_name,
        propertyName: context.property?.property_name || 'your property',
        message: parsed.data.message,
      })

      const escalated = generated.escalate || generated.intent === 'escalate'

      await insertTenantChatMessage({
        supabaseAdminClient: options.supabaseAdminClient,
        tenantId: context.tenant.id,
        ownerId: context.owner.id,
        senderType: 'tenant',
        message: parsed.data.message,
        intent: generated.intent,
        escalated,
      })

      await insertTenantChatMessage({
        supabaseAdminClient: options.supabaseAdminClient,
        tenantId: context.tenant.id,
        ownerId: context.owner.id,
        senderType: 'bot',
        message: generated.reply,
        intent: generated.intent,
        escalated,
      })

      if (escalated) {
        await createOwnerNotification({
          supabaseAdminClient: options.supabaseAdminClient,
          ownerId: context.owner.id,
          tenantId: context.tenant.id,
          notificationType: 'chat_escalation',
          title: `Escalation from ${context.tenant.full_name}`,
          message: parsed.data.message,
        })

        if (options.mailer) {
          options.mailer
            .sendPropertyEscalationNotification({
              to: context.owner.support_email,
              submittedAtIso: new Date().toISOString(),
              ownerCompanyName: context.owner.company_name,
              tenantName: context.tenant.full_name,
              tenantAccessId: context.tenant.tenant_access_id,
              intent: generated.intent,
              message: parsed.data.message,
            })
            .catch((error) => {
              console.error(
                JSON.stringify({
                  level: 'error',
                  type: 'property_escalation_email_failed',
                  message: error instanceof Error ? error.message : 'Unknown escalation email error',
                }),
              )
            })
        }
      }

      response.json({
        ok: true,
        reply: generated.reply,
        intent: generated.intent,
        escalated,
      })
    }),
  )

  router.get(
    '/tenant/owner-contact',
    tenantGuard,
    asyncHandler(async (request, response) => {
      const tenantRequest = toTenantAuthenticatedRequest(request)
      const context = await loadTenantSummaryContext(
        options.supabaseAdminClient,
        tenantRequest.tenantUser.tenantId,
      )
      if (!context) {
        throw new AppError('Tenant profile not found', 404)
      }

      const whatsappStub = buildTenantWhatsAppSupportStub({
        ownerId: context.owner.id,
        tenantId: context.tenant.id,
        supportWhatsApp: context.owner.support_whatsapp,
      })

      response.json({
        ok: true,
        owner: context.owner,
        whatsapp: whatsappStub,
      })
    }),
  )

  router.post(
    '/system/process-reminders',
    ownerGuard,
    asyncHandler(async (request, response) => {
      const parsed = processRemindersSchema.safeParse(request.body ?? {})
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const authRequest = toAuthenticatedRequest(request)
      if (authRequest.user.role !== 'admin') {
        throw new AppError('Admin access required', 403)
      }

      const referenceDate = parsed.data.referenceDate ? new Date(parsed.data.referenceDate) : new Date()
      const result = await processPendingRentReminders({
        supabaseAdminClient: options.supabaseAdminClient,
        now: referenceDate,
        limit: 500,
      })

      response.json({
        ok: true,
        result,
      })
    }),
  )

  router.get(
    '/owner/tenants/:tenantId/tickets',
    ownerGuard,
    asyncHandler(async (request, response) => {
      const authRequest = toAuthenticatedRequest(request)
      const owner = await resolveOwnerContext({
        supabaseAdminClient: options.supabaseAdminClient,
        userId: authRequest.user.userId,
      })

      const tenantId = String(request.params.tenantId)
      const tenant = await loadOwnerTenantById(
        options.supabaseAdminClient,
        owner.id,
        tenantId,
      )
      if (!tenant) {
        throw new AppError('Tenant not found', 404)
      }

      const tickets = await listTenantTickets(options.supabaseAdminClient, tenant.id)
      response.json({
        ok: true,
        tickets,
      })
    }),
  )

  router.get(
    '/owner/tenants/:tenantId/messages',
    ownerGuard,
    asyncHandler(async (request, response) => {
      const authRequest = toAuthenticatedRequest(request)
      const owner = await resolveOwnerContext({
        supabaseAdminClient: options.supabaseAdminClient,
        userId: authRequest.user.userId,
      })

      const tenantId = String(request.params.tenantId)
      const tenant = await loadOwnerTenantById(
        options.supabaseAdminClient,
        owner.id,
        tenantId,
      )
      if (!tenant) {
        throw new AppError('Tenant not found', 404)
      }

      const messages = await listTenantMessages(
        options.supabaseAdminClient,
        tenant.id,
      )

      response.json({
        ok: true,
        messages,
      })
    }),
  )

  router.get(
    '/owner/tenants/:tenantId/reminders',
    ownerGuard,
    asyncHandler(async (request, response) => {
      const authRequest = toAuthenticatedRequest(request)
      const owner = await resolveOwnerContext({
        supabaseAdminClient: options.supabaseAdminClient,
        userId: authRequest.user.userId,
      })

      const tenantId = String(request.params.tenantId)
      const tenant = await loadOwnerTenantById(
        options.supabaseAdminClient,
        owner.id,
        tenantId,
      )
      if (!tenant) {
        throw new AppError('Tenant not found', 404)
      }

      const reminders = await listRentRemindersByTenant(
        options.supabaseAdminClient,
        owner.id,
        tenant.id,
      )

      response.json({
        ok: true,
        reminders,
      })
    }),
  )

  router.get(
    '/owner/tenants/:tenantId/summary',
    ownerGuard,
    asyncHandler(async (request, response) => {
      const authRequest = toAuthenticatedRequest(request)
      const owner = await resolveOwnerContext({
        supabaseAdminClient: options.supabaseAdminClient,
        userId: authRequest.user.userId,
      })

      const tenantId = String(request.params.tenantId)
      const detail = await loadOwnerTenantDetail(
        options.supabaseAdminClient,
        owner.id,
        tenantId,
      )
      if (!detail) {
        throw new AppError('Tenant not found', 404)
      }

      const pagination = paginationQuerySchema.safeParse(request.query)
      if (!pagination.success) {
        return respondValidationError(pagination.error, response)
      }

      const offset = pagination.data.offset ?? 0
      const limit = pagination.data.limit ?? 50
      const pagedMessages = detail.messages.slice(offset, offset + limit)

      response.json({
        ok: true,
        tenant: detail.tenant,
        property: detail.property,
        tickets: detail.tickets,
        reminders: detail.reminders,
        messages: pagedMessages,
        paging: {
          offset,
          limit,
          total: detail.messages.length,
        },
      })
    }),
  )

  return router
}
