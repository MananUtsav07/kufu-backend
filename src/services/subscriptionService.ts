import type { SupabaseClient } from '@supabase/supabase-js'
import { AppError } from '../lib/errors.js'
import type { UserRole } from '../types/auth.js'

export type PlanRow = {
  id: string
  code: string
  name: string
  monthly_message_cap: number | null
  chatbot_limit: number | null
  price_inr: number
  is_active: boolean
}

export type SubscriptionRow = {
  id: string
  user_id: string
  plan_code: string
  status: string
  current_period_start: string
  current_period_end: string
  message_count_in_period: number
  total_message_count: number
  created_at: string
  updated_at: string
}

const DEFAULT_SUBSCRIPTION_STATUS = 'active'
const ROLLING_PERIOD_DAYS = 30

function createPeriodWindow(now = new Date()): { start: string; end: string } {
  const periodStart = now
  const periodEnd = new Date(now.getTime() + ROLLING_PERIOD_DAYS * 24 * 60 * 60 * 1000)

  return {
    start: periodStart.toISOString(),
    end: periodEnd.toISOString(),
  }
}

export async function loadPlanByCode(
  supabaseAdminClient: SupabaseClient,
  planCode: string,
): Promise<PlanRow> {
  const { data, error } = await supabaseAdminClient
    .from('plans')
    .select('id, code, name, monthly_message_cap, chatbot_limit, price_inr, is_active')
    .eq('code', planCode)
    .eq('is_active', true)
    .maybeSingle<PlanRow>()

  if (error) {
    throw new AppError(`Failed to load plan: ${error.message}`, 500)
  }

  if (!data) {
    throw new AppError(`Plan not found: ${planCode}`, 500)
  }

  return data
}

export async function ensureSubscription(
  supabaseAdminClient: SupabaseClient,
  userId: string,
): Promise<SubscriptionRow> {
  const { data: existingSubscription, error: lookupError } = await supabaseAdminClient
    .from('subscriptions')
    .select(
      'id, user_id, plan_code, status, current_period_start, current_period_end, message_count_in_period, total_message_count, created_at, updated_at',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<SubscriptionRow>()

  if (lookupError) {
    throw new AppError(`Failed to load subscription: ${lookupError.message}`, 500)
  }

  if (existingSubscription) {
    return rollSubscriptionPeriodIfNeeded(supabaseAdminClient, existingSubscription)
  }

  await loadPlanByCode(supabaseAdminClient, 'free')
  const period = createPeriodWindow()

  const { data: createdSubscription, error: createError } = await supabaseAdminClient
    .from('subscriptions')
    .insert({
      user_id: userId,
      plan_code: 'free',
      status: DEFAULT_SUBSCRIPTION_STATUS,
      current_period_start: period.start,
      current_period_end: period.end,
      message_count_in_period: 0,
      total_message_count: 0,
    })
    .select(
      'id, user_id, plan_code, status, current_period_start, current_period_end, message_count_in_period, total_message_count, created_at, updated_at',
    )
    .single<SubscriptionRow>()

  if (createError || !createdSubscription) {
    throw new AppError(`Failed to create subscription: ${createError?.message || 'unknown error'}`, 500)
  }

  return createdSubscription
}

export async function rollSubscriptionPeriodIfNeeded(
  supabaseAdminClient: SupabaseClient,
  subscription: SubscriptionRow,
): Promise<SubscriptionRow> {
  const now = new Date()
  const periodEnd = new Date(subscription.current_period_end)
  if (Number.isNaN(periodEnd.getTime()) || periodEnd > now) {
    return subscription
  }

  const period = createPeriodWindow(now)

  const { data: updatedSubscription, error: updateError } = await supabaseAdminClient
    .from('subscriptions')
    .update({
      current_period_start: period.start,
      current_period_end: period.end,
      message_count_in_period: 0,
      updated_at: now.toISOString(),
    })
    .eq('id', subscription.id)
    .select(
      'id, user_id, plan_code, status, current_period_start, current_period_end, message_count_in_period, total_message_count, created_at, updated_at',
    )
    .single<SubscriptionRow>()

  if (updateError || !updatedSubscription) {
    throw new AppError(`Failed to roll subscription period: ${updateError?.message || 'unknown error'}`, 500)
  }

  return updatedSubscription
}

export async function incrementSubscriptionUsage(
  supabaseAdminClient: SupabaseClient,
  subscription: SubscriptionRow,
  amount = 1,
): Promise<SubscriptionRow> {
  const { data: updatedSubscription, error: updateError } = await supabaseAdminClient
    .from('subscriptions')
    .update({
      message_count_in_period: subscription.message_count_in_period + amount,
      total_message_count: subscription.total_message_count + amount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscription.id)
    .select(
      'id, user_id, plan_code, status, current_period_start, current_period_end, message_count_in_period, total_message_count, created_at, updated_at',
    )
    .single<SubscriptionRow>()

  if (updateError || !updatedSubscription) {
    throw new AppError(`Failed to update subscription usage: ${updateError?.message || 'unknown error'}`, 500)
  }

  return updatedSubscription
}

export type UsageCheckResult = {
  allowed: boolean
  reason?: string
  plan: PlanRow | null
  subscription: SubscriptionRow | null
}

export async function enforcePlanMessageLimit(
  supabaseAdminClient: SupabaseClient,
  userId: string,
  role: UserRole,
): Promise<UsageCheckResult> {
  if (role === 'admin') {
    return {
      allowed: true,
      plan: null,
      subscription: null,
    }
  }

  const subscription = await ensureSubscription(supabaseAdminClient, userId)
  const rolledSubscription = await rollSubscriptionPeriodIfNeeded(supabaseAdminClient, subscription)
  const plan = await loadPlanByCode(supabaseAdminClient, rolledSubscription.plan_code)

  if (plan.code === 'business') {
    return {
      allowed: true,
      plan,
      subscription: rolledSubscription,
    }
  }

  if (plan.code === 'free') {
    if (rolledSubscription.total_message_count >= 10) {
      return {
        allowed: false,
        reason: 'Free plan lifetime cap reached (10 messages). Please request an upgrade.',
        plan,
        subscription: rolledSubscription,
      }
    }

    return {
      allowed: true,
      plan,
      subscription: rolledSubscription,
    }
  }

  const cap = plan.monthly_message_cap
  if (cap !== null && rolledSubscription.message_count_in_period >= cap) {
    return {
      allowed: false,
      reason: `${plan.name} monthly cap reached (${cap} messages). Please request an upgrade.`,
      plan,
      subscription: rolledSubscription,
    }
  }

  return {
    allowed: true,
    plan,
    subscription: rolledSubscription,
  }
}

export function resolveChatbotLimitForPlan(plan: PlanRow | null, role: UserRole): number {
  if (role === 'admin') {
    return Number.MAX_SAFE_INTEGER
  }

  if (!plan) {
    return 1
  }

  if (plan.code === 'business') {
    return plan.chatbot_limit ?? 10
  }

  if (plan.code === 'starter' || plan.code === 'pro' || plan.code === 'free') {
    return 1
  }

  return plan.chatbot_limit ?? 1
}

export async function setSubscriptionPlan(
  supabaseAdminClient: SupabaseClient,
  userId: string,
  planCode: string,
): Promise<SubscriptionRow> {
  await loadPlanByCode(supabaseAdminClient, planCode)
  const currentSubscription = await ensureSubscription(supabaseAdminClient, userId)

  const { data: updatedSubscription, error: updateError } = await supabaseAdminClient
    .from('subscriptions')
    .update({
      plan_code: planCode,
      status: DEFAULT_SUBSCRIPTION_STATUS,
      updated_at: new Date().toISOString(),
    })
    .eq('id', currentSubscription.id)
    .select(
      'id, user_id, plan_code, status, current_period_start, current_period_end, message_count_in_period, total_message_count, created_at, updated_at',
    )
    .single<SubscriptionRow>()

  if (updateError || !updatedSubscription) {
    throw new AppError(`Failed to set subscription plan: ${updateError?.message || 'unknown error'}`, 500)
  }

  return updatedSubscription
}

export async function resetExpiredSubscriptionPeriods(
  supabaseAdminClient: SupabaseClient,
): Promise<number> {
  const nowIso = new Date().toISOString()

  const { data: expiredSubscriptions, error: expiredError } = await supabaseAdminClient
    .from('subscriptions')
    .select(
      'id, user_id, plan_code, status, current_period_start, current_period_end, message_count_in_period, total_message_count, created_at, updated_at',
    )
    .lt('current_period_end', nowIso)
    .returns<SubscriptionRow[]>()

  if (expiredError) {
    throw new AppError(`Failed to load expired subscriptions: ${expiredError.message}`, 500)
  }

  let resetCount = 0
  for (const subscription of expiredSubscriptions ?? []) {
    await rollSubscriptionPeriodIfNeeded(supabaseAdminClient, subscription)
    resetCount += 1
  }

  return resetCount
}
