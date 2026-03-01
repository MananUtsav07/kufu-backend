import { z } from 'zod'

export const adminMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  user_id: z.string().uuid().optional(),
  chatbot_id: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

export const adminTicketPatchSchema = z
  .object({
    status: z.enum(['open', 'closed']).optional(),
    admin_response: z.string().trim().max(5000).optional(),
  })
  .strict()

export const adminQuotePatchSchema = z
  .object({
    status: z.enum(['pending', 'responded', 'closed', 'approved']).optional(),
    admin_response: z.string().trim().max(5000).optional(),
    approve_plan: z.enum(['free', 'starter', 'pro', 'business']).optional(),
  })
  .strict()

export const adminSetPlanSchema = z
  .object({
    plan_code: z.enum(['free', 'starter', 'pro', 'business']),
  })
  .strict()

export const adminUserPlanUpdateSchema = z
  .object({
    planCode: z.enum(['free', 'starter', 'pro', 'business']),
  })
  .strict()
