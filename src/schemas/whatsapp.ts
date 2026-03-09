import { z } from 'zod'

const optionalShortString = z.string().trim().max(200).optional().or(z.literal(''))
const optionalTokenString = z.string().trim().max(4000).optional().or(z.literal(''))
const optionalIdString = z.string().trim().max(120).optional().or(z.literal(''))
const optionalPhoneString = z.string().trim().max(40).optional().or(z.literal(''))

export const whatsappOnboardingStartSchema = z
  .object({
    chatbotId: z.string().uuid().optional().or(z.literal('')),
    state: optionalShortString,
  })
  .strict()

export const whatsappOnboardingCompleteSchema = z
  .object({
    chatbotId: z.string().uuid().optional().or(z.literal('')),
    businessAccountId: optionalIdString,
    phoneNumberId: optionalIdString,
    displayPhoneNumber: optionalPhoneString,
    phoneNumber: optionalPhoneString,
    accessToken: optionalTokenString,
    code: optionalTokenString,
    verifyToken: optionalShortString,
    state: optionalShortString,
    onboardingPayload: z.unknown().optional(),
    authResponse: z
      .object({
        accessToken: optionalTokenString,
        code: optionalTokenString,
      })
      .strict()
      .optional(),
    isActive: z.boolean().optional().default(true),
    autoSubscribe: z.boolean().optional().default(true),
  })
  .strict()

export const whatsappWebhookSubscribeSchema = z
  .object({
    verifyToken: optionalShortString,
  })
  .strict()
