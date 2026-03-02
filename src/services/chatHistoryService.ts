import type { SupabaseClient } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'

export type ChatHistoryRow = {
  id: string
  chatbot_id: string
  visitor_id: string
  user_message: string
  bot_response: string
  lead_captured: boolean
  created_at: string
}

type ChatHistoryFilters = {
  from?: string
  to?: string
  leadCaptured?: boolean
  limit: number
  offset: number
}

function applyHistoryFilters(query: any, filters: ChatHistoryFilters) {
  let nextQuery = query

  if (filters.from) {
    nextQuery = nextQuery.gte('created_at', filters.from)
  }

  if (filters.to) {
    nextQuery = nextQuery.lte('created_at', filters.to)
  }

  if (typeof filters.leadCaptured === 'boolean') {
    nextQuery = nextQuery.eq('lead_captured', filters.leadCaptured)
  }

  return nextQuery
}

export async function insertChatHistoryRow(args: {
  supabaseAdminClient: SupabaseClient
  chatbotId: string
  visitorId: string
  userMessage: string
  botResponse: string
  leadCaptured: boolean
}): Promise<void> {
  const { error } = await args.supabaseAdminClient.from('chat_messages').insert({
    chatbot_id: args.chatbotId,
    visitor_id: args.visitorId,
    user_message: args.userMessage,
    bot_response: args.botResponse,
    lead_captured: args.leadCaptured,
  })

  if (error) {
    throw new AppError(`Failed to insert chat history row: ${error.message}`, 500)
  }
}

export async function listChatHistory(args: {
  supabaseAdminClient: SupabaseClient
  chatbotId: string
  from?: string
  to?: string
  leadCaptured?: boolean
  limit: number
  offset: number
}): Promise<{ rows: ChatHistoryRow[]; total: number }> {
  const baseQuery = args.supabaseAdminClient
    .from('chat_messages')
    .select('id, chatbot_id, visitor_id, user_message, bot_response, lead_captured, created_at', { count: 'exact' })
    .eq('chatbot_id', args.chatbotId)

  const filteredQuery = applyHistoryFilters(baseQuery, {
    from: args.from,
    to: args.to,
    leadCaptured: args.leadCaptured,
    limit: args.limit,
    offset: args.offset,
  })
    .order('created_at', { ascending: false })
    .range(args.offset, args.offset + args.limit - 1)

  const { data, count, error } = await filteredQuery

  if (error) {
    throw new AppError(`Failed to load chat history: ${error.message}`, 500)
  }

  return {
    rows: (data ?? []) as ChatHistoryRow[],
    total: count ?? 0,
  }
}

export async function searchChatHistory(args: {
  supabaseAdminClient: SupabaseClient
  chatbotId: string
  queryText: string
  from?: string
  to?: string
  leadCaptured?: boolean
  limit: number
  offset: number
}): Promise<{ rows: ChatHistoryRow[]; total: number }> {
  const escapedQuery = args.queryText.trim().replace(/[%_]/g, '\\$&')
  const ilikeToken = `%${escapedQuery}%`

  const baseQuery = args.supabaseAdminClient
    .from('chat_messages')
    .select('id, chatbot_id, visitor_id, user_message, bot_response, lead_captured, created_at', { count: 'exact' })
    .eq('chatbot_id', args.chatbotId)
    .or(`user_message.ilike.${ilikeToken},bot_response.ilike.${ilikeToken}`)

  const filteredQuery = applyHistoryFilters(baseQuery, {
    from: args.from,
    to: args.to,
    leadCaptured: args.leadCaptured,
    limit: args.limit,
    offset: args.offset,
  })
    .order('created_at', { ascending: false })
    .range(args.offset, args.offset + args.limit - 1)

  const { data, count, error } = await filteredQuery
  if (error) {
    throw new AppError(`Failed to search chat history: ${error.message}`, 500)
  }

  return {
    rows: (data ?? []) as ChatHistoryRow[],
    total: count ?? 0,
  }
}

export async function isFirstVisitorSessionMessage(args: {
  supabaseAdminClient: SupabaseClient
  chatbotId: string
  visitorId: string
}): Promise<boolean> {
  const { count, error } = await args.supabaseAdminClient
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('chatbot_id', args.chatbotId)
    .eq('visitor_id', args.visitorId)

  if (error) {
    throw new AppError(`Failed to check session message count: ${error.message}`, 500)
  }

  return (count ?? 0) === 0
}

export async function isFirstLeadCaptureForVisitorSession(args: {
  supabaseAdminClient: SupabaseClient
  chatbotId: string
  visitorId: string
}): Promise<boolean> {
  const { count, error } = await args.supabaseAdminClient
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('chatbot_id', args.chatbotId)
    .eq('visitor_id', args.visitorId)
    .eq('lead_captured', true)

  if (error) {
    throw new AppError(`Failed to check lead capture count: ${error.message}`, 500)
  }

  return (count ?? 0) === 0
}
