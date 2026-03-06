import { z } from 'zod'

export const dashboardSummaryQuerySchema = z.object({
  limit_sessions: z.coerce.number().int().min(1).max(100).default(20),
})

export const dashboardProfileSchema = z
  .object({
    business_name: z.string().trim().min(1).max(200),
    website_url: z.string().trim().url().optional().or(z.literal('')).nullable(),
  })
  .strict()

export const dashboardChatbotCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    website_url: z.string().trim().url().optional().or(z.literal('')).nullable(),
    allowed_domains: z.array(z.string().trim().min(1)).max(25).optional(),
    is_active: z.boolean().optional(),
  })
  .strict()

export const dashboardChatbotUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    website_url: z.string().trim().url().optional().or(z.literal('')).nullable(),
    allowed_domains: z.array(z.string().trim().min(1)).max(25).optional(),
    is_active: z.boolean().optional(),
  })
  .strict()

export const dashboardKnowledgeSchema = z
  .object({
    services_text: z.string().optional().nullable(),
    pricing_text: z.string().optional().nullable(),
    faqs_json: z.array(z.unknown()).optional().default([]),
    hours_text: z.string().optional().nullable(),
    contact_text: z.string().optional().nullable(),
    knowledge_base_text: z.string().optional().nullable(),
  })
  .strict()

export const dashboardTicketCreateSchema = z
  .object({
    subject: z.string().trim().min(3).max(200),
    message: z.string().trim().min(3).max(5000),
  })
  .strict()

export const dashboardTicketUpdateSchema = z
  .object({
    status: z.enum(['open', 'closed']),
  })
  .strict()

export const dashboardQuoteCreateSchema = z
  .object({
    requested_plan: z.enum(['starter', 'pro', 'business']).nullable().optional(),
    requested_chatbots: z.coerce.number().int().min(1).max(100).optional(),
    requested_monthly_messages: z.coerce.number().int().min(1).max(100000000).optional(),
    requested_unlimited_messages: z.boolean().optional().default(false),
    notes: z.string().trim().min(1).max(5000),
  })
  .strict()

export const dashboardLeadsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().trim().optional(),
})

export const dashboardLeadStatusSchema = z
  .object({
    status: z.string().trim().min(1).max(50),
  })
  .strict()

export const dashboardChatHistoryQuerySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    leadCaptured: z
      .union([z.literal('yes'), z.literal('no')])
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict()

export const dashboardChatHistorySearchQuerySchema = z
  .object({
    chatbotId: z.string().uuid(),
    q: z.string().trim().min(1).max(500),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    leadCaptured: z
      .union([z.literal('yes'), z.literal('no')])
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict()

export const dashboardAnalyticsQuerySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict()

export const dashboardTestChatSchema = z
  .object({
    sessionId: z.string().trim().max(120).optional(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            content: z.string().trim().min(1).max(4000),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict()

export const dashboardWhatsAppConnectSchema = z
  .object({
    chatbotId: z.string().uuid(),
    phoneNumberId: z.string().trim().min(3).max(100),
    businessAccountId: z.string().trim().max(120).optional().or(z.literal('')),
    displayPhoneNumber: z.string().trim().max(40).optional().or(z.literal('')),
    accessToken: z.string().trim().max(1000).optional().or(z.literal('')),
    verifyToken: z.string().trim().max(200).optional().or(z.literal('')),
    webhookSecret: z.string().trim().max(200).optional().or(z.literal('')),
    isActive: z.boolean().optional().default(true),
  })
  .strict()

export const dashboardWhatsAppTestMessageSchema = z
  .object({
    to: z.string().trim().min(6).max(30),
    message: z.string().trim().min(1).max(1000),
  })
  .strict()
