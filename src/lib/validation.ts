import { z } from 'zod'

export const emailSchema = z.string().trim().email('Valid email is required')
export const passwordSchema = z.string().min(8, 'Password must be at least 8 characters')
export const uuidSchema = z.string().uuid('Invalid UUID')
export const urlSchema = z.string().trim().url('Invalid URL')

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function optionalTrimmed(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function parseHostnameFromUrl(value: string | null): string | null {
  if (!value) {
    return null
  }

  try {
    const parsed = new URL(value)
    return parsed.hostname.toLowerCase()
  } catch {
    return null
  }
}

export function ensureArrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}
