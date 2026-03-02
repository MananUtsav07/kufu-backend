import type { SupabaseClient } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import type { ChatbotRow } from './tenantService.js'

export type ChatbotSettingsRow = {
  id: string
  chatbot_id: string
  bot_name: string
  greeting_message: string
  primary_color: string
  updated_at: string
}

function defaultGreeting(botName: string): string {
  return `Hi, welcome to ${botName}. How can we help you today?`
}

export function buildDefaultSettings(chatbot: ChatbotRow): Omit<ChatbotSettingsRow, 'id' | 'updated_at'> {
  return {
    chatbot_id: chatbot.id,
    bot_name: chatbot.name,
    greeting_message: defaultGreeting(chatbot.name),
    primary_color: '#6366f1',
  }
}

export async function getChatbotSettings(args: {
  supabaseAdminClient: SupabaseClient
  chatbot: ChatbotRow
}): Promise<ChatbotSettingsRow | null> {
  const { data, error } = await args.supabaseAdminClient
    .from('chatbot_settings')
    .select('id, chatbot_id, bot_name, greeting_message, primary_color, updated_at')
    .eq('chatbot_id', args.chatbot.id)
    .maybeSingle<ChatbotSettingsRow>()

  if (error) {
    throw new AppError(`Failed to load chatbot settings: ${error.message}`, 500)
  }

  return data ?? null
}

export async function upsertChatbotSettings(args: {
  supabaseAdminClient: SupabaseClient
  chatbot: ChatbotRow
  botName: string
  greetingMessage: string
  primaryColor: string
}): Promise<ChatbotSettingsRow> {
  const { data, error } = await args.supabaseAdminClient
    .from('chatbot_settings')
    .upsert(
      {
        chatbot_id: args.chatbot.id,
        bot_name: args.botName,
        greeting_message: args.greetingMessage,
        primary_color: args.primaryColor,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'chatbot_id' },
    )
    .select('id, chatbot_id, bot_name, greeting_message, primary_color, updated_at')
    .single<ChatbotSettingsRow>()

  if (error || !data) {
    throw new AppError(`Failed to save chatbot settings: ${error?.message || 'unknown error'}`, 500)
  }

  return data
}
