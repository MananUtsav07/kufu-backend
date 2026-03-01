import { z } from 'zod'

export const demoLeadSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Full name is required'),
    businessType: z.string().trim().min(1, 'Business type is required'),
    websiteUrl: z.string().trim().max(2048).optional().default(''),
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
    sessionId: z.string().trim().min(1).max(120).optional(),
    key: z.string().trim().min(8).optional(),
    widgetKey: z.string().trim().min(8).optional(),
    chatbot_id: z.string().uuid().optional(),
    chatbotId: z.string().uuid().optional(),
    client_id: z.string().uuid().optional(),
    metadata: z
      .object({
        page: z.string().trim().optional(),
        client_id: z.string().uuid().optional(),
        chatbot_id: z.string().uuid().optional(),
        chatbotId: z.string().uuid().optional(),
        key: z.string().trim().optional(),
        widgetKey: z.string().trim().optional(),
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

export const widgetConfigQuerySchema = z.object({
  key: z.string().trim().min(8, 'key is required'),
})

export const ragIngestStartSchema = z
  .object({
    chatbotId: z.string().uuid(),
    websiteUrl: z.string().trim().url(),
    maxPages: z.coerce.number().int().min(1).max(200).optional().default(60),
    urls: z.array(z.string().trim().url()).max(200).optional().default([]),
  })
  .strict()

export const ragIngestStatusQuerySchema = z.object({
  runId: z.string().uuid(),
})

export const ragIngestCancelSchema = z
  .object({
    runId: z.string().uuid(),
  })
  .strict()

export const ragIngestResyncSchema = z
  .object({
    chatbotId: z.string().uuid(),
    websiteUrl: z.string().trim().url().optional(),
    maxPages: z.coerce.number().int().min(1).max(200).optional().default(60),
    urls: z.array(z.string().trim().url()).max(200).optional().default([]),
  })
  .strict()
