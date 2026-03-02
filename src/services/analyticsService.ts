import type { SupabaseClient } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import type { ChatHistoryRow } from './chatHistoryService.js'

export type AnalyticsPopularQuestion = {
  question: string
  count: number
}

export type AnalyticsPeakHour = {
  hour: number
  count: number
}

export type DashboardAnalytics = {
  totalChats: number
  popularQuestions: AnalyticsPopularQuestion[]
  peakHours: AnalyticsPeakHour[]
}

export async function computeChatAnalytics(args: {
  supabaseAdminClient: SupabaseClient
  chatbotId: string
  from?: string
  to?: string
}): Promise<DashboardAnalytics> {
  let query = args.supabaseAdminClient
    .from('chat_messages')
    .select('id, chatbot_id, visitor_id, user_message, bot_response, lead_captured, created_at')
    .eq('chatbot_id', args.chatbotId)

  if (args.from) {
    query = query.gte('created_at', args.from)
  }
  if (args.to) {
    query = query.lte('created_at', args.to)
  }

  const { data, error } = await query.returns<ChatHistoryRow[]>()

  if (error) {
    throw new AppError(`Failed to compute analytics: ${error.message}`, 500)
  }

  const rows = data ?? []
  const visitorIds = new Set<string>()
  const questionCount = new Map<string, number>()
  const sessionFirstTimestamp = new Map<string, number>()

  for (const row of rows) {
    visitorIds.add(row.visitor_id)

    const normalizedQuestion = row.user_message.trim()
    if (normalizedQuestion) {
      questionCount.set(
        normalizedQuestion,
        (questionCount.get(normalizedQuestion) ?? 0) + 1,
      )
    }

    const createdAtMs = new Date(row.created_at).getTime()
    if (!Number.isNaN(createdAtMs)) {
      const existing = sessionFirstTimestamp.get(row.visitor_id)
      if (existing === undefined || createdAtMs < existing) {
        sessionFirstTimestamp.set(row.visitor_id, createdAtMs)
      }
    }
  }

  const popularQuestions = Array.from(questionCount.entries())
    .map(([question, count]) => ({ question, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 10)

  const hourlyCount = new Map<number, number>()
  for (const ts of sessionFirstTimestamp.values()) {
    const hour = new Date(ts).getUTCHours()
    hourlyCount.set(hour, (hourlyCount.get(hour) ?? 0) + 1)
  }

  const peakHours = Array.from(hourlyCount.entries())
    .map(([hour, count]) => ({ hour, count }))
    .sort((left, right) => left.hour - right.hour)

  return {
    totalChats: visitorIds.size,
    popularQuestions,
    peakHours,
  }
}
