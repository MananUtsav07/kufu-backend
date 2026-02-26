import { z } from 'zod'

export const demoLeadSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Full name is required'),
    businessType: z.string().trim().min(1, 'Business type is required'),
    phone: z.string().trim().min(1, 'Phone is required'),
    email: z.string().trim().email('Valid email is required'),
    message: z.string().trim().optional().default(''),
  })
  .strict()

export const contactLeadSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required'),
    lastName: z.string().trim().min(1, 'Last name is required'),
    email: z.string().trim().email('Valid email is required'),
    message: z.string().trim().optional().default(''),
  })
  .strict()

export const chatSchema = z
  .object({
    messages: z.unknown(),
    metadata: z
      .object({
        page: z.string().trim().optional(),
        client_id: z.string().uuid().optional(),
      })
      .optional(),
    client_id: z.string().uuid().optional(),
    sessionId: z.string().trim().optional(),
    lead: z
      .object({
        name: z.string().trim().optional(),
        email: z.string().trim().email().optional(),
        phone: z.string().trim().optional(),
        need: z.string().trim().optional(),
        client_id: z.string().uuid().optional(),
      })
      .optional(),
  })
  .strict()

export const chatLogSchema = z
  .object({
    sessionId: z.string().trim().min(1, 'sessionId is required'),
    page: z.string().trim().optional(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            content: z.string().trim().min(1, 'Message content is required'),
            createdAt: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1, 'At least one message is required'),
  })
  .strict()
