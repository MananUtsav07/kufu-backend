import { z } from 'zod'

const emailSchema = z.string().trim().email('Valid email is required')

export const registerSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(8, 'Password must be at least 8 characters'),
    name: z.string().trim().optional(),
  })
  .strict()

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required'),
  })
  .strict()

export const verifyQuerySchema = z.object({
  token: z.string().trim().min(1, 'Token is required'),
  email: emailSchema,
})
