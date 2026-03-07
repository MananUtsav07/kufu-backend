import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { normalizeEmail } from '../lib/validation.js'

export type PropertyOwnerRow = {
  id: string
  user_id: string
  company_name: string
  support_email: string
  support_whatsapp: string | null
  created_at: string
}

export type PropertyRow = {
  id: string
  owner_id: string
  property_name: string
  address: string
  unit_number: string | null
  created_at: string
}

export type PropertyTenantRow = {
  id: string
  owner_id: string
  property_id: string
  full_name: string
  email: string
  phone: string | null
  tenant_access_id: string
  password_hash: string
  lease_start_date: string | null
  lease_end_date: string | null
  monthly_rent: number
  payment_due_day: number
  payment_status: 'pending' | 'paid' | 'overdue' | 'partial'
  status: 'active' | 'inactive' | 'terminated'
  created_at: string
}

export type TenantSupportTicketRow = {
  id: string
  tenant_id: string
  owner_id: string
  subject: string
  message: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  created_at: string
  updated_at: string
}

export type TenantChatMessageRow = {
  id: string
  tenant_id: string
  owner_id: string
  sender_type: 'tenant' | 'bot' | 'owner'
  message: string
  intent: string | null
  escalated: boolean
  created_at: string
}

export type RentReminderRow = {
  id: string
  tenant_id: string
  owner_id: string
  reminder_type: '7_days_before' | '1_day_before' | 'due_today' | '3_days_late' | '7_days_late'
  scheduled_for: string
  sent_at: string | null
  status: 'pending' | 'sent' | 'failed' | 'canceled'
  created_at: string
}

export type OwnerNotificationRow = {
  id: string
  owner_id: string
  tenant_id: string | null
  notification_type: string
  title: string
  message: string
  is_read: boolean
  created_at: string
}

export type TenantSessionRow = {
  id: string
  tenant_id: string
  token: string
  expires_at: string
  created_at: string
}

export type PropertyTenantListItem = Omit<PropertyTenantRow, 'password_hash'> & {
  property: Pick<PropertyRow, 'id' | 'property_name' | 'address' | 'unit_number'> | null
}

export type OwnerTenantDetail = {
  tenant: Omit<PropertyTenantRow, 'password_hash'>
  property: PropertyRow | null
  tickets: TenantSupportTicketRow[]
  reminders: RentReminderRow[]
  messages: TenantChatMessageRow[]
}

export type TenantSummaryContext = {
  tenant: Omit<PropertyTenantRow, 'password_hash'>
  property: PropertyRow | null
  owner: Pick<PropertyOwnerRow, 'id' | 'company_name' | 'support_email' | 'support_whatsapp'>
}

type CreatePropertyTenantInput = {
  ownerId: string
  propertyId: string
  fullName: string
  email: string
  phone: string | null
  tenantAccessId: string
  passwordHash: string
  leaseStartDate: string | null
  leaseEndDate: string | null
  monthlyRent: number
  paymentDueDay: number
  paymentStatus: 'pending' | 'paid' | 'overdue' | 'partial'
  status: 'active' | 'inactive' | 'terminated'
}

function throwQueryError(message: string, error: { message: string } | null): never {
  throw new AppError(`${message}: ${error?.message ?? 'unknown error'}`, 500)
}

function parseNumeric(value: number | string): number {
  if (typeof value === 'number') {
    return value
  }

  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) {
    throw new AppError('Invalid numeric value', 400)
  }

  return numeric
}

export function createTenantAccessId(): string {
  const suffix = randomBytes(4).toString('hex').toUpperCase()
  return `TEN-${suffix}`
}

export function createTemporaryTenantPassword(): string {
  return randomBytes(8).toString('base64url')
}

export async function loadPropertyOwnerByUserId(
  supabaseAdminClient: SupabaseClient,
  userId: string,
): Promise<PropertyOwnerRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('property_owners')
    .select('id, user_id, company_name, support_email, support_whatsapp, created_at')
    .eq('user_id', userId)
    .maybeSingle<PropertyOwnerRow>()

  if (error) {
    throwQueryError('Failed to query property owner', error)
  }

  return data ?? null
}

export async function loadPropertyOwnerById(
  supabaseAdminClient: SupabaseClient,
  ownerId: string,
): Promise<PropertyOwnerRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('property_owners')
    .select('id, user_id, company_name, support_email, support_whatsapp, created_at')
    .eq('id', ownerId)
    .maybeSingle<PropertyOwnerRow>()

  if (error) {
    throwQueryError('Failed to query property owner by id', error)
  }

  return data ?? null
}

export async function ensurePropertyOwnerProfile(args: {
  supabaseAdminClient: SupabaseClient
  userId: string
  companyName: string
  supportEmail: string
  supportWhatsApp?: string | null
}): Promise<PropertyOwnerRow> {
  const existing = await loadPropertyOwnerByUserId(args.supabaseAdminClient, args.userId)
  if (existing) {
    return existing
  }

  const { data, error } = await args.supabaseAdminClient
    .from('property_owners')
    .insert({
      user_id: args.userId,
      company_name: args.companyName.trim(),
      support_email: normalizeEmail(args.supportEmail),
      support_whatsapp: args.supportWhatsApp?.trim() || null,
    })
    .select('id, user_id, company_name, support_email, support_whatsapp, created_at')
    .single<PropertyOwnerRow>()

  if (error || !data) {
    throwQueryError('Failed to create property owner profile', error)
  }

  return data
}

export async function createProperty(args: {
  supabaseAdminClient: SupabaseClient
  ownerId: string
  propertyName: string
  address: string
  unitNumber?: string | null
}): Promise<PropertyRow> {
  const { data, error } = await args.supabaseAdminClient
    .from('properties')
    .insert({
      owner_id: args.ownerId,
      property_name: args.propertyName.trim(),
      address: args.address.trim(),
      unit_number: args.unitNumber?.trim() || null,
    })
    .select('id, owner_id, property_name, address, unit_number, created_at')
    .single<PropertyRow>()

  if (error || !data) {
    throwQueryError('Failed to create property', error)
  }

  return data
}

export async function loadOwnerPropertyById(
  supabaseAdminClient: SupabaseClient,
  ownerId: string,
  propertyId: string,
): Promise<PropertyRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('properties')
    .select('id, owner_id, property_name, address, unit_number, created_at')
    .eq('id', propertyId)
    .eq('owner_id', ownerId)
    .maybeSingle<PropertyRow>()

  if (error) {
    throwQueryError('Failed to query property', error)
  }

  return data ?? null
}

export async function createPropertyTenant(
  supabaseAdminClient: SupabaseClient,
  input: CreatePropertyTenantInput,
): Promise<PropertyTenantRow> {
  const { data, error } = await supabaseAdminClient
    .from('property_tenants')
    .insert({
      owner_id: input.ownerId,
      property_id: input.propertyId,
      full_name: input.fullName.trim(),
      email: normalizeEmail(input.email),
      phone: input.phone?.trim() || null,
      tenant_access_id: input.tenantAccessId.trim(),
      password_hash: input.passwordHash,
      lease_start_date: input.leaseStartDate,
      lease_end_date: input.leaseEndDate,
      monthly_rent: input.monthlyRent,
      payment_due_day: input.paymentDueDay,
      payment_status: input.paymentStatus,
      status: input.status,
    })
    .select(
      'id, owner_id, property_id, full_name, email, phone, tenant_access_id, password_hash, lease_start_date, lease_end_date, monthly_rent, payment_due_day, payment_status, status, created_at',
    )
    .single<PropertyTenantRow>()

  if (error || !data) {
    throwQueryError('Failed to create tenant', error)
  }

  return data
}

export async function loadOwnerTenants(
  supabaseAdminClient: SupabaseClient,
  ownerId: string,
): Promise<PropertyTenantListItem[]> {
  const { data, error } = await supabaseAdminClient
    .from('property_tenants')
    .select(
      'id, owner_id, property_id, full_name, email, phone, tenant_access_id, lease_start_date, lease_end_date, monthly_rent, payment_due_day, payment_status, status, created_at, properties(id, property_name, address, unit_number)',
    )
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })

  if (error) {
    throwQueryError('Failed to list owner tenants', error)
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    owner_id: row.owner_id,
    property_id: row.property_id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    tenant_access_id: row.tenant_access_id,
    lease_start_date: row.lease_start_date,
    lease_end_date: row.lease_end_date,
    monthly_rent: parseNumeric(row.monthly_rent),
    payment_due_day: row.payment_due_day,
    payment_status: row.payment_status,
    status: row.status,
    created_at: row.created_at,
    property: Array.isArray(row.properties) ? row.properties[0] ?? null : row.properties ?? null,
  }))
}

export async function loadOwnerTenantById(
  supabaseAdminClient: SupabaseClient,
  ownerId: string,
  tenantId: string,
): Promise<PropertyTenantRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('property_tenants')
    .select(
      'id, owner_id, property_id, full_name, email, phone, tenant_access_id, password_hash, lease_start_date, lease_end_date, monthly_rent, payment_due_day, payment_status, status, created_at',
    )
    .eq('owner_id', ownerId)
    .eq('id', tenantId)
    .maybeSingle<PropertyTenantRow>()

  if (error) {
    throwQueryError('Failed to load owner tenant', error)
  }

  return data
    ? {
        ...data,
        monthly_rent: parseNumeric(data.monthly_rent),
      }
    : null
}

export async function loadOwnerTenantDetail(
  supabaseAdminClient: SupabaseClient,
  ownerId: string,
  tenantId: string,
): Promise<OwnerTenantDetail | null> {
  const tenant = await loadOwnerTenantById(supabaseAdminClient, ownerId, tenantId)
  if (!tenant) {
    return null
  }

  const [property, tickets, reminders, messages] = await Promise.all([
    loadOwnerPropertyById(supabaseAdminClient, ownerId, tenant.property_id),
    listOwnerTicketsByTenant(supabaseAdminClient, ownerId, tenant.id),
    listRentRemindersByTenant(supabaseAdminClient, ownerId, tenant.id),
    listTenantMessagesByTenant(supabaseAdminClient, ownerId, tenant.id),
  ])

  const { password_hash: _passwordHash, ...tenantSafe } = tenant
  return {
    tenant: tenantSafe,
    property,
    tickets,
    reminders,
    messages,
  }
}

export async function listOwnerTickets(
  supabaseAdminClient: SupabaseClient,
  ownerId: string,
): Promise<TenantSupportTicketRow[]> {
  const { data, error } = await supabaseAdminClient
    .from('tenant_support_tickets')
    .select('id, tenant_id, owner_id, subject, message, status, created_at, updated_at')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
    .returns<TenantSupportTicketRow[]>()

  if (error) {
    throwQueryError('Failed to list owner tickets', error)
  }

  return data ?? []
}

export async function listOwnerTicketsByTenant(
  supabaseAdminClient: SupabaseClient,
  ownerId: string,
  tenantId: string,
): Promise<TenantSupportTicketRow[]> {
  const { data, error } = await supabaseAdminClient
    .from('tenant_support_tickets')
    .select('id, tenant_id, owner_id, subject, message, status, created_at, updated_at')
    .eq('owner_id', ownerId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .returns<TenantSupportTicketRow[]>()

  if (error) {
    throwQueryError('Failed to list tenant tickets', error)
  }

  return data ?? []
}

export async function updateOwnerTicketStatus(args: {
  supabaseAdminClient: SupabaseClient
  ownerId: string
  ticketId: string
  status: TenantSupportTicketRow['status']
}): Promise<TenantSupportTicketRow> {
  const { data, error } = await args.supabaseAdminClient
    .from('tenant_support_tickets')
    .update({
      status: args.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.ticketId)
    .eq('owner_id', args.ownerId)
    .select('id, tenant_id, owner_id, subject, message, status, created_at, updated_at')
    .single<TenantSupportTicketRow>()

  if (error || !data) {
    throwQueryError('Failed to update ticket status', error)
  }

  return data
}

export async function listOwnerNotifications(
  supabaseAdminClient: SupabaseClient,
  ownerId: string,
): Promise<OwnerNotificationRow[]> {
  const { data, error } = await supabaseAdminClient
    .from('owner_notifications')
    .select('id, owner_id, tenant_id, notification_type, title, message, is_read, created_at')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
    .returns<OwnerNotificationRow[]>()

  if (error) {
    throwQueryError('Failed to list owner notifications', error)
  }

  return data ?? []
}

export async function createOwnerNotification(args: {
  supabaseAdminClient: SupabaseClient
  ownerId: string
  tenantId?: string | null
  notificationType: string
  title: string
  message: string
}): Promise<OwnerNotificationRow> {
  const { data, error } = await args.supabaseAdminClient
    .from('owner_notifications')
    .insert({
      owner_id: args.ownerId,
      tenant_id: args.tenantId ?? null,
      notification_type: args.notificationType,
      title: args.title,
      message: args.message,
      is_read: false,
    })
    .select('id, owner_id, tenant_id, notification_type, title, message, is_read, created_at')
    .single<OwnerNotificationRow>()

  if (error || !data) {
    throwQueryError('Failed to create owner notification', error)
  }

  return data
}

export async function loadOwnerDashboardSummary(
  supabaseAdminClient: SupabaseClient,
  ownerId: string,
): Promise<{
  activeTenants: number
  openTickets: number
  overdueRent: number
  escalatedChats: number
  remindersPending: number
}> {
  const [activeTenants, openTickets, overdueRent, escalatedChats, remindersPending] = await Promise.all([
    countRows(supabaseAdminClient, 'property_tenants', { owner_id: ownerId, status: 'active' }),
    countRows(supabaseAdminClient, 'tenant_support_tickets', { owner_id: ownerId, status: 'open' }),
    countRows(supabaseAdminClient, 'property_tenants', { owner_id: ownerId, payment_status: 'overdue' }),
    countRows(supabaseAdminClient, 'tenant_chat_messages', { owner_id: ownerId, escalated: true }),
    countRows(supabaseAdminClient, 'rent_reminders', { owner_id: ownerId, status: 'pending' }),
  ])

  return {
    activeTenants,
    openTickets,
    overdueRent,
    escalatedChats,
    remindersPending,
  }
}

async function countRows(
  supabaseAdminClient: SupabaseClient,
  tableName: string,
  filters: Record<string, string | boolean>,
): Promise<number> {
  let query = supabaseAdminClient.from(tableName).select('id', { count: 'exact', head: true })
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value)
  }

  const { count, error } = await query
  if (error) {
    throwQueryError(`Failed to count ${tableName}`, error)
  }

  return count ?? 0
}

export async function loadTenantByAccessId(
  supabaseAdminClient: SupabaseClient,
  tenantAccessId: string,
): Promise<PropertyTenantRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('property_tenants')
    .select(
      'id, owner_id, property_id, full_name, email, phone, tenant_access_id, password_hash, lease_start_date, lease_end_date, monthly_rent, payment_due_day, payment_status, status, created_at',
    )
    .eq('tenant_access_id', tenantAccessId.trim())
    .maybeSingle<PropertyTenantRow>()

  if (error) {
    throwQueryError('Failed to load tenant by access id', error)
  }

  return data
    ? {
        ...data,
        monthly_rent: parseNumeric(data.monthly_rent),
      }
    : null
}

export async function createTenantDashboardSession(args: {
  supabaseAdminClient: SupabaseClient
  tenantId: string
  token: string
  expiresAt: string
}): Promise<TenantSessionRow> {
  const { data, error } = await args.supabaseAdminClient
    .from('tenant_dashboard_sessions')
    .insert({
      tenant_id: args.tenantId,
      token: args.token,
      expires_at: args.expiresAt,
    })
    .select('id, tenant_id, token, expires_at, created_at')
    .single<TenantSessionRow>()

  if (error || !data) {
    throwQueryError('Failed to create tenant session', error)
  }

  return data
}

export async function loadTenantSessionByToken(
  supabaseAdminClient: SupabaseClient,
  token: string,
): Promise<TenantSessionRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('tenant_dashboard_sessions')
    .select('id, tenant_id, token, expires_at, created_at')
    .eq('token', token)
    .maybeSingle<TenantSessionRow>()

  if (error) {
    throwQueryError('Failed to load tenant session', error)
  }

  return data ?? null
}

export async function loadTenantSummaryContext(
  supabaseAdminClient: SupabaseClient,
  tenantId: string,
): Promise<TenantSummaryContext | null> {
  const { data: tenant, error: tenantError } = await supabaseAdminClient
    .from('property_tenants')
    .select(
      'id, owner_id, property_id, full_name, email, phone, tenant_access_id, lease_start_date, lease_end_date, monthly_rent, payment_due_day, payment_status, status, created_at',
    )
    .eq('id', tenantId)
    .maybeSingle<Omit<PropertyTenantRow, 'password_hash'>>()

  if (tenantError) {
    throwQueryError('Failed to load tenant context', tenantError)
  }

  if (!tenant) {
    return null
  }

  const [property, owner] = await Promise.all([
    loadPropertyById(supabaseAdminClient, tenant.property_id),
    loadPropertyOwnerById(supabaseAdminClient, tenant.owner_id),
  ])

  if (!owner) {
    throw new AppError('Owner not found for tenant', 500)
  }

  return {
    tenant: {
      ...tenant,
      monthly_rent: parseNumeric(tenant.monthly_rent),
    },
    property,
    owner: {
      id: owner.id,
      company_name: owner.company_name,
      support_email: owner.support_email,
      support_whatsapp: owner.support_whatsapp,
    },
  }
}

export async function loadPropertyById(
  supabaseAdminClient: SupabaseClient,
  propertyId: string,
): Promise<PropertyRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('properties')
    .select('id, owner_id, property_name, address, unit_number, created_at')
    .eq('id', propertyId)
    .maybeSingle<PropertyRow>()

  if (error) {
    throwQueryError('Failed to load property', error)
  }

  return data ?? null
}

export async function createTenantSupportTicket(args: {
  supabaseAdminClient: SupabaseClient
  tenantId: string
  ownerId: string
  subject: string
  message: string
}): Promise<TenantSupportTicketRow> {
  const { data, error } = await args.supabaseAdminClient
    .from('tenant_support_tickets')
    .insert({
      tenant_id: args.tenantId,
      owner_id: args.ownerId,
      subject: args.subject.trim(),
      message: args.message.trim(),
      status: 'open',
    })
    .select('id, tenant_id, owner_id, subject, message, status, created_at, updated_at')
    .single<TenantSupportTicketRow>()

  if (error || !data) {
    throwQueryError('Failed to create tenant support ticket', error)
  }

  return data
}

export async function listTenantTickets(
  supabaseAdminClient: SupabaseClient,
  tenantId: string,
): Promise<TenantSupportTicketRow[]> {
  const { data, error } = await supabaseAdminClient
    .from('tenant_support_tickets')
    .select('id, tenant_id, owner_id, subject, message, status, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .returns<TenantSupportTicketRow[]>()

  if (error) {
    throwQueryError('Failed to list tenant tickets', error)
  }

  return data ?? []
}

export async function listTenantMessagesByTenant(
  supabaseAdminClient: SupabaseClient,
  ownerId: string,
  tenantId: string,
): Promise<TenantChatMessageRow[]> {
  const { data, error } = await supabaseAdminClient
    .from('tenant_chat_messages')
    .select('id, tenant_id, owner_id, sender_type, message, intent, escalated, created_at')
    .eq('owner_id', ownerId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .returns<TenantChatMessageRow[]>()

  if (error) {
    throwQueryError('Failed to list tenant messages', error)
  }

  return data ?? []
}

export async function listTenantMessages(
  supabaseAdminClient: SupabaseClient,
  tenantId: string,
): Promise<TenantChatMessageRow[]> {
  const { data, error } = await supabaseAdminClient
    .from('tenant_chat_messages')
    .select('id, tenant_id, owner_id, sender_type, message, intent, escalated, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .returns<TenantChatMessageRow[]>()

  if (error) {
    throwQueryError('Failed to list tenant chat timeline', error)
  }

  return data ?? []
}

export async function insertTenantChatMessage(args: {
  supabaseAdminClient: SupabaseClient
  tenantId: string
  ownerId: string
  senderType: 'tenant' | 'bot' | 'owner'
  message: string
  intent?: string | null
  escalated?: boolean
}): Promise<TenantChatMessageRow> {
  const { data, error } = await args.supabaseAdminClient
    .from('tenant_chat_messages')
    .insert({
      tenant_id: args.tenantId,
      owner_id: args.ownerId,
      sender_type: args.senderType,
      message: args.message.trim(),
      intent: args.intent ?? null,
      escalated: Boolean(args.escalated),
    })
    .select('id, tenant_id, owner_id, sender_type, message, intent, escalated, created_at')
    .single<TenantChatMessageRow>()

  if (error || !data) {
    throwQueryError('Failed to insert tenant chat message', error)
  }

  return data
}

function buildReminderTimeline(dueDate: Date): Array<{ type: RentReminderRow['reminder_type']; date: Date }> {
  const dayMs = 24 * 60 * 60 * 1000
  return [
    { type: '7_days_before', date: new Date(dueDate.getTime() - 7 * dayMs) },
    { type: '1_day_before', date: new Date(dueDate.getTime() - dayMs) },
    { type: 'due_today', date: new Date(dueDate) },
    { type: '3_days_late', date: new Date(dueDate.getTime() + 3 * dayMs) },
    { type: '7_days_late', date: new Date(dueDate.getTime() + 7 * dayMs) },
  ]
}

export async function scheduleRentRemindersForTenant(args: {
  supabaseAdminClient: SupabaseClient
  tenantId: string
  ownerId: string
  paymentDueDay: number
  referenceDate?: Date
}): Promise<number> {
  const referenceDate = args.referenceDate ?? new Date()
  const dueDate = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), args.paymentDueDay, 10, 0, 0))
  const reminderRows = buildReminderTimeline(dueDate).map((entry) => ({
    tenant_id: args.tenantId,
    owner_id: args.ownerId,
    reminder_type: entry.type,
    scheduled_for: entry.date.toISOString(),
    status: 'pending',
  }))

  const { data, error } = await args.supabaseAdminClient
    .from('rent_reminders')
    .upsert(reminderRows, {
      onConflict: 'tenant_id,reminder_type,scheduled_for',
      ignoreDuplicates: true,
    })
    .select('id')

  if (error) {
    throwQueryError('Failed to schedule rent reminders', error)
  }

  return data?.length ?? 0
}

export async function processPendingRentReminders(args: {
  supabaseAdminClient: SupabaseClient
  now?: Date
  limit?: number
}): Promise<{ processed: number; pending: number }> {
  const nowIso = (args.now ?? new Date()).toISOString()
  const limit = args.limit ?? 200

  const { data: dueRows, error: dueError, count } = await args.supabaseAdminClient
    .from('rent_reminders')
    .select('id', { count: 'exact' })
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(limit)

  if (dueError) {
    throwQueryError('Failed to load pending reminders', dueError)
  }

  const reminderIds = (dueRows ?? []).map((row) => row.id as string)
  if (reminderIds.length === 0) {
    return {
      processed: 0,
      pending: count ?? 0,
    }
  }

  const { error: updateError } = await args.supabaseAdminClient
    .from('rent_reminders')
    .update({
      status: 'sent',
      sent_at: nowIso,
    })
    .in('id', reminderIds)

  if (updateError) {
    throwQueryError('Failed to mark reminders as sent', updateError)
  }

  return {
    processed: reminderIds.length,
    pending: Math.max((count ?? reminderIds.length) - reminderIds.length, 0),
  }
}

export async function listRentRemindersByTenant(
  supabaseAdminClient: SupabaseClient,
  ownerId: string,
  tenantId: string,
): Promise<RentReminderRow[]> {
  const { data, error } = await supabaseAdminClient
    .from('rent_reminders')
    .select('id, tenant_id, owner_id, reminder_type, scheduled_for, sent_at, status, created_at')
    .eq('owner_id', ownerId)
    .eq('tenant_id', tenantId)
    .order('scheduled_for', { ascending: false })
    .returns<RentReminderRow[]>()

  if (error) {
    throwQueryError('Failed to list rent reminders', error)
  }

  return data ?? []
}

export async function loadTenantDashboardSummary(
  supabaseAdminClient: SupabaseClient,
  tenantId: string,
): Promise<{
  openTickets: number
  recentMessages: number
  pendingReminders: number
  paymentStatus: PropertyTenantRow['payment_status']
  monthlyRent: number
  dueDay: number
}> {
  const tenantContext = await loadTenantSummaryContext(supabaseAdminClient, tenantId)
  if (!tenantContext) {
    throw new AppError('Tenant not found', 404)
  }

  const [openTickets, recentMessages, pendingReminders] = await Promise.all([
    countRows(supabaseAdminClient, 'tenant_support_tickets', { tenant_id: tenantId, status: 'open' }),
    countRows(supabaseAdminClient, 'tenant_chat_messages', { tenant_id: tenantId }),
    countRows(supabaseAdminClient, 'rent_reminders', { tenant_id: tenantId, status: 'pending' }),
  ])

  return {
    openTickets,
    recentMessages,
    pendingReminders,
    paymentStatus: tenantContext.tenant.payment_status,
    monthlyRent: tenantContext.tenant.monthly_rent,
    dueDay: tenantContext.tenant.payment_due_day,
  }
}
