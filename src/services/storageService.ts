import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'

export const LOGO_BUCKET = 'kufu-logos'
export const KB_DOCS_BUCKET = 'kufu-kb-docs'
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 3600

function sanitizeFileName(originalName: string): string {
  const baseName = path.basename(originalName).trim().toLowerCase()
  const normalized = baseName
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/-+/g, '-')

  if (!normalized) {
    return 'file'
  }

  return normalized.slice(0, 120)
}

export function buildLogoStoragePath(args: {
  userId: string
  chatbotId: string
  originalName: string
  timestamp?: number
}): string {
  const now = args.timestamp ?? Date.now()
  const fileName = sanitizeFileName(args.originalName)
  return `logos/${args.userId}/${args.chatbotId}/${now}_${fileName}`
}

export function buildKbStoragePath(args: {
  userId: string
  chatbotId: string
  originalName: string
  timestamp?: number
}): string {
  const now = args.timestamp ?? Date.now()
  const fileName = sanitizeFileName(args.originalName)
  return `kb/${args.userId}/${args.chatbotId}/${now}_${fileName}`
}

export async function uploadBufferToStorage(args: {
  supabaseAdminClient: SupabaseClient
  bucket: string
  storagePath: string
  fileBuffer: Buffer
  contentType: string
}): Promise<void> {
  const { error } = await args.supabaseAdminClient.storage.from(args.bucket).upload(args.storagePath, args.fileBuffer, {
    contentType: args.contentType,
    upsert: false,
  })

  if (error) {
    throw new AppError(`Failed to upload file to storage: ${error.message}`, 500)
  }
}

export async function removeObjectFromStorage(args: {
  supabaseAdminClient: SupabaseClient
  bucket: string
  storagePath: string | null | undefined
}): Promise<void> {
  if (!args.storagePath) {
    return
  }

  const { error } = await args.supabaseAdminClient.storage.from(args.bucket).remove([args.storagePath])

  if (error) {
    throw new AppError(`Failed to delete file from storage: ${error.message}`, 500)
  }
}

export async function createSignedStorageUrl(args: {
  supabaseAdminClient: SupabaseClient
  bucket: string
  storagePath: string | null | undefined
  expiresInSeconds?: number
}): Promise<string | null> {
  if (!args.storagePath) {
    return null
  }

  const ttl = args.expiresInSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS
  const { data, error } = await args.supabaseAdminClient.storage
    .from(args.bucket)
    .createSignedUrl(args.storagePath, ttl)

  if (error) {
    throw new AppError(`Failed to create signed file URL: ${error.message}`, 500)
  }

  return data?.signedUrl ?? null
}

