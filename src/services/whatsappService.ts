import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'

export type WhatsAppIntegrationRow = {
  id: string
  user_id: string
  client_id: string | null
  chatbot_id: string
  phone_number_id: string
  business_account_id: string | null
  display_phone_number: string | null
  access_token: string
  verify_token: string
  webhook_secret: string | null
  is_active: boolean
  last_inbound_at: string | null
  created_at: string
  updated_at: string
}

type UpsertWhatsAppIntegrationInput = {
  userId: string
  clientId: string | null
  chatbotId: string
  phoneNumberId: string
  businessAccountId?: string | null
  displayPhoneNumber?: string | null
  accessToken: string
  verifyToken: string
  webhookSecret?: string | null
  isActive: boolean
}

type SendWhatsAppTextMessageInput = {
  graphApiVersion: string
  accessToken: string
  phoneNumberId: string
  to: string
  text: string
}

function normalizeTrimmed(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function createWhatsAppVerifyToken(): string {
  return randomBytes(18).toString('hex')
}

export function normalizeWhatsAppAddress(value: string): string {
  return value.replace(/[^\d]/g, '').trim()
}

export async function loadWhatsAppIntegrationByUserId(
  supabaseAdminClient: SupabaseClient,
  userId: string,
): Promise<WhatsAppIntegrationRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('whatsapp_integrations')
    .select(
      'id, user_id, client_id, chatbot_id, phone_number_id, business_account_id, display_phone_number, access_token, verify_token, webhook_secret, is_active, last_inbound_at, created_at, updated_at',
    )
    .eq('user_id', userId)
    .maybeSingle<WhatsAppIntegrationRow>()

  if (error) {
    throw new AppError(`Failed to query WhatsApp integration by user: ${error.message}`, 500)
  }

  return data ?? null
}

export async function loadWhatsAppIntegrationByPhoneNumberId(
  supabaseAdminClient: SupabaseClient,
  phoneNumberId: string,
): Promise<WhatsAppIntegrationRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('whatsapp_integrations')
    .select(
      'id, user_id, client_id, chatbot_id, phone_number_id, business_account_id, display_phone_number, access_token, verify_token, webhook_secret, is_active, last_inbound_at, created_at, updated_at',
    )
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle<WhatsAppIntegrationRow>()

  if (error) {
    throw new AppError(`Failed to query WhatsApp integration by phone number id: ${error.message}`, 500)
  }

  return data ?? null
}

export async function loadWhatsAppIntegrationByVerifyToken(
  supabaseAdminClient: SupabaseClient,
  verifyToken: string,
): Promise<WhatsAppIntegrationRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('whatsapp_integrations')
    .select(
      'id, user_id, client_id, chatbot_id, phone_number_id, business_account_id, display_phone_number, access_token, verify_token, webhook_secret, is_active, last_inbound_at, created_at, updated_at',
    )
    .eq('verify_token', verifyToken)
    .maybeSingle<WhatsAppIntegrationRow>()

  if (error) {
    throw new AppError(`Failed to query WhatsApp integration by verify token: ${error.message}`, 500)
  }

  return data ?? null
}

export async function upsertWhatsAppIntegration(
  supabaseAdminClient: SupabaseClient,
  input: UpsertWhatsAppIntegrationInput,
): Promise<WhatsAppIntegrationRow> {
  const payload = {
    user_id: input.userId,
    client_id: input.clientId,
    chatbot_id: input.chatbotId,
    phone_number_id: input.phoneNumberId.trim(),
    business_account_id: normalizeTrimmed(input.businessAccountId),
    display_phone_number: normalizeTrimmed(input.displayPhoneNumber),
    access_token: input.accessToken.trim(),
    verify_token: input.verifyToken.trim(),
    webhook_secret: normalizeTrimmed(input.webhookSecret),
    is_active: input.isActive,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabaseAdminClient
    .from('whatsapp_integrations')
    .upsert(payload, {
      onConflict: 'user_id',
    })
    .select(
      'id, user_id, client_id, chatbot_id, phone_number_id, business_account_id, display_phone_number, access_token, verify_token, webhook_secret, is_active, last_inbound_at, created_at, updated_at',
    )
    .single<WhatsAppIntegrationRow>()

  if (error || !data) {
    throw new AppError(`Failed to save WhatsApp integration: ${error?.message ?? 'unknown error'}`, 500)
  }

  return data
}

export async function removeWhatsAppIntegrationByUserId(
  supabaseAdminClient: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await supabaseAdminClient
    .from('whatsapp_integrations')
    .delete()
    .eq('user_id', userId)

  if (error) {
    throw new AppError(`Failed to delete WhatsApp integration: ${error.message}`, 500)
  }
}

export async function updateWhatsAppIntegrationLastInboundAt(
  supabaseAdminClient: SupabaseClient,
  integrationId: string,
): Promise<void> {
  const { error } = await supabaseAdminClient
    .from('whatsapp_integrations')
    .update({
      last_inbound_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', integrationId)

  if (error) {
    throw new AppError(`Failed to update WhatsApp integration heartbeat: ${error.message}`, 500)
  }
}

export async function sendWhatsAppTextMessage(
  input: SendWhatsAppTextMessageInput,
): Promise<{ providerMessageId: string | null }> {
  const version = input.graphApiVersion.trim().replace(/^v/i, '')
  const endpoint = `https://graph.facebook.com/v${version}/${encodeURIComponent(input.phoneNumberId)}/messages`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to,
      type: 'text',
      text: {
        body: input.text,
      },
    }),
  })

  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string }
    messages?: Array<{ id?: string }>
  }

  if (!response.ok) {
    const providerError = payload.error?.message || `HTTP ${response.status}`
    throw new AppError(`Failed to send WhatsApp message: ${providerError}`, 502)
  }

  return {
    providerMessageId: payload.messages?.[0]?.id ?? null,
  }
}
