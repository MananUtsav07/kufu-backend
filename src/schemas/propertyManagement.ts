import { z } from 'zod'

const positiveMoneyRegex = /^\d+(\.\d{1,2})?$/

export const ownerCreateTenantSchema = z.object({
  property_id: z.string().uuid().optional(),
  property_name: z.string().trim().min(2).max(120).optional(),
  address: z.string().trim().min(4).max(240).optional(),
  unit_number: z.string().trim().max(60).optional(),
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().max(40).optional(),
  password: z.string().min(8).max(120).optional(),
  lease_start_date: z.string().date().optional(),
  lease_end_date: z.string().date().optional(),
  monthly_rent: z.union([z.number().positive().max(100000000), z.string().regex(positiveMoneyRegex)]),
  payment_due_day: z.number().int().min(1).max(31),
  payment_status: z.enum(['pending', 'paid', 'overdue', 'partial']).optional(),
  status: z.enum(['active', 'inactive', 'terminated']).optional(),
})

export const ownerTicketStatusUpdateSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']),
})

export const tenantLoginSchema = z.object({
  tenant_access_id: z.string().trim().min(4).max(64),
  password: z.string().min(8).max(120),
  email: z.string().trim().email().max(160).optional(),
})

export const tenantCreateTicketSchema = z.object({
  subject: z.string().trim().min(3).max(160),
  message: z.string().trim().min(5).max(3000),
})

export const tenantChatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
})

export const processRemindersSchema = z.object({
  referenceDate: z.string().datetime().optional(),
})

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})
