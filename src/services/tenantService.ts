import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AppError } from '../lib/errors.js'
import { parseHostnameFromUrl } from '../lib/validation.js'

export type UserRow = {
  id: string
  email: string
  password_hash: string
  is_verified: boolean
  role: 'user' | 'admin'
  created_at?: string
}

export type ClientRow = {
  id: string
  user_id: string
  business_name: string
  website_url: string | null
  plan: string
  knowledge_base_text: string | null
  created_at?: string
}

export type ChatbotRow = {
  id: string
  user_id: string
  client_id: string | null
  name: string
  website_url: string | null
  allowed_domains: string[]
  widget_public_key: string
  logo_path: string | null
  logo_updated_at: string | null
  is_active: boolean
  branding: Record<string, unknown> | null
  created_at: string
  updated_at?: string
}

export async function loadUserByEmail(
  supabaseAdminClient: SupabaseClient,
  email: string,
): Promise<UserRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('users')
    .select('id, email, password_hash, is_verified, role, created_at')
    .eq('email', email)
    .maybeSingle<UserRow>()

  if (error) {
    throw new AppError(`Failed to query user: ${error.message}`, 500)
  }

  return data ?? null
}

export async function loadUserById(
  supabaseAdminClient: SupabaseClient,
  userId: string,
): Promise<UserRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('users')
    .select('id, email, password_hash, is_verified, role, created_at')
    .eq('id', userId)
    .maybeSingle<UserRow>()

  if (error) {
    throw new AppError(`Failed to query user by id: ${error.message}`, 500)
  }

  return data ?? null
}

export async function loadClientByUserId(
  supabaseAdminClient: SupabaseClient,
  userId: string,
): Promise<ClientRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('clients')
    .select('id, user_id, business_name, website_url, plan, knowledge_base_text, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<ClientRow>()

  if (error) {
    throw new AppError(`Failed to query client by user: ${error.message}`, 500)
  }

  return data ?? null
}

export async function loadClientById(
  supabaseAdminClient: SupabaseClient,
  clientId: string,
): Promise<ClientRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('clients')
    .select('id, user_id, business_name, website_url, plan, knowledge_base_text, created_at')
    .eq('id', clientId)
    .maybeSingle<ClientRow>()

  if (error) {
    throw new AppError(`Failed to query client by id: ${error.message}`, 500)
  }

  return data ?? null
}

export async function ensureClientForUser(
  supabaseAdminClient: SupabaseClient,
  args: {
    userId: string
    businessName: string
    websiteUrl: string | null
  },
): Promise<ClientRow> {
  const existingClient = await loadClientByUserId(supabaseAdminClient, args.userId)
  if (existingClient) {
    return existingClient
  }

  const { data, error } = await supabaseAdminClient
    .from('clients')
    .insert({
      user_id: args.userId,
      business_name: args.businessName,
      website_url: args.websiteUrl,
      plan: 'free',
      knowledge_base_text: '',
    })
    .select('id, user_id, business_name, website_url, plan, knowledge_base_text, created_at')
    .single<ClientRow>()

  if (error || !data) {
    throw new AppError(`Failed to create client: ${error?.message || 'unknown error'}`, 500)
  }

  return data
}

export async function ensureTenantOwnership(
  supabaseAdminClient: SupabaseClient,
  userId: string,
  clientId: string,
): Promise<ClientRow> {
  const client = await loadClientById(supabaseAdminClient, clientId)
  if (!client || client.user_id !== userId) {
    throw new AppError('Forbidden: invalid client ownership', 403)
  }

  return client
}

export function createWidgetPublicKey(): string {
  return randomBytes(24).toString('hex')
}

export function buildAllowedDomains(websiteUrl: string | null, explicitAllowedDomains?: string[]): string[] {
  const domains = new Set<string>()

  const websiteHost = parseHostnameFromUrl(websiteUrl)
  if (websiteHost) {
    domains.add(websiteHost)
  }

  for (const domain of explicitAllowedDomains ?? []) {
    const normalized = domain.trim().toLowerCase()
    if (!normalized) {
      continue
    }

    const withoutScheme = normalized
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
      .split('/')[0] || ''

    if (withoutScheme) {
      domains.add(withoutScheme)
    }
  }

  return Array.from(domains)
}

export function extractDomainFromRequestOrigin(originOrReferrer: string | null): string | null {
  if (!originOrReferrer) {
    return null
  }

  try {
    return new URL(originOrReferrer).hostname.toLowerCase()
  } catch {
    return null
  }
}

export async function loadChatbotByPublicKey(
  supabaseAdminClient: SupabaseClient,
  widgetPublicKey: string,
): Promise<ChatbotRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('chatbots')
    .select(
      'id, user_id, client_id, name, website_url, allowed_domains, widget_public_key, logo_path, logo_updated_at, is_active, branding, created_at, updated_at',
    )
    .eq('widget_public_key', widgetPublicKey)
    .maybeSingle<ChatbotRow>()

  if (error) {
    throw new AppError(`Failed to query chatbot by key: ${error.message}`, 500)
  }

  return data ?? null
}

export async function loadChatbotById(
  supabaseAdminClient: SupabaseClient,
  chatbotId: string,
): Promise<ChatbotRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('chatbots')
    .select(
      'id, user_id, client_id, name, website_url, allowed_domains, widget_public_key, logo_path, logo_updated_at, is_active, branding, created_at, updated_at',
    )
    .eq('id', chatbotId)
    .maybeSingle<ChatbotRow>()

  if (error) {
    throw new AppError(`Failed to query chatbot by id: ${error.message}`, 500)
  }

  return data ?? null
}

export async function loadUserChatbots(
  supabaseAdminClient: SupabaseClient,
  userId: string,
): Promise<ChatbotRow[]> {
  const { data, error } = await supabaseAdminClient
    .from('chatbots')
    .select(
      'id, user_id, client_id, name, website_url, allowed_domains, widget_public_key, logo_path, logo_updated_at, is_active, branding, created_at, updated_at',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .returns<ChatbotRow[]>()

  if (error) {
    throw new AppError(`Failed to list chatbots: ${error.message}`, 500)
  }

  return data ?? []
}

export async function ensureDefaultChatbot(
  supabaseAdminClient: SupabaseClient,
  args: {
    userId: string
    clientId: string
    websiteUrl: string | null
    businessName: string
  },
): Promise<ChatbotRow> {
  const chatbots = await loadUserChatbots(supabaseAdminClient, args.userId)
  if (chatbots.length > 0) {
    return chatbots[0]
  }

  const allowedDomains = buildAllowedDomains(args.websiteUrl)
  const key = createWidgetPublicKey()

  const { data, error } = await supabaseAdminClient
    .from('chatbots')
    .insert({
      user_id: args.userId,
      client_id: args.clientId,
      name: `${args.businessName} Primary Bot`,
      website_url: args.websiteUrl,
      allowed_domains: allowedDomains,
      widget_public_key: key,
      logo_path: null,
      logo_updated_at: null,
      is_active: true,
      branding: {},
    })
    .select(
      'id, user_id, client_id, name, website_url, allowed_domains, widget_public_key, logo_path, logo_updated_at, is_active, branding, created_at, updated_at',
    )
    .single<ChatbotRow>()

  if (error || !data) {
    throw new AppError(`Failed to create default chatbot: ${error?.message || 'unknown error'}`, 500)
  }

  return data
}
