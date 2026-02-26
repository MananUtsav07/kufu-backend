import { z } from 'zod'

export const leadsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().trim().optional(),
})

export const updateLeadStatusSchema = z
  .object({
    status: z.string().trim().min(1, 'status is required').max(50, 'status is too long'),
  })
  .strict()

export const knowledgeUpsertSchema = z
  .object({
    services_text: z.string().optional().nullable(),
    pricing_text: z.string().optional().nullable(),
    faqs_json: z.array(z.unknown()).optional().default([]),
    hours_text: z.string().optional().nullable(),
    contact_text: z.string().optional().nullable(),
  })
  .strict()

export const widgetConfigQuerySchema = z.object({
  client_id: z.string().uuid('client_id must be a valid UUID'),
})
