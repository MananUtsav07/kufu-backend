import { z } from 'zod'
import { emailSchema, passwordSchema } from '../lib/validation.js'

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    business_name: z.string().trim().min(1).max(200).optional(),
    website_url: z.string().trim().url().optional().or(z.literal('')),
  })
  .strict()

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required'),
  })
  .strict()

export const verifyEmailSchema = z
  .object({
    token: z.string().trim().min(1, 'Token is required'),
  })
  .strict()

export const authTokenQuerySchema = z.object({
  token: z.string().trim().min(1, 'Token is required').optional(),
})
