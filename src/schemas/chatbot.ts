import { z } from 'zod'

export const chatbotSettingsUpdateSchema = z
  .object({
    bot_name: z.string().trim().min(1).max(200),
    greeting_message: z.string().trim().min(1).max(2000),
    primary_color: z
      .string()
      .trim()
      .regex(/^#([0-9a-fA-F]{6})$/, 'primary_color must be a valid 6-digit hex color'),
  })
  .strict()
