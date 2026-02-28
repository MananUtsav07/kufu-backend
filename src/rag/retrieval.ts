import type OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AppError } from '../lib/errors.js'
import { embedText } from './embeddings.js'
import { toVectorLiteral } from './store.js'

export type RetrievedChunk = {
  chunkText: string
  url: string
  similarity: number
}

type RagMatchRow = {
  chunk_text: string
  url: string
  similarity: number
}

export async function retrieveRelevantChunks(args: {
  supabaseAdminClient: SupabaseClient
  openAiClient: OpenAI
  chatbotId: string
  queryText: string
  topK?: number
}): Promise<RetrievedChunk[]> {
  const topK = Math.max(1, Math.min(args.topK ?? 8, 10))
  const queryEmbedding = await embedText(args.openAiClient, args.queryText)

  if (!queryEmbedding.length) {
    return []
  }

  const { data, error } = await args.supabaseAdminClient.rpc('rag_match_chunks', {
    p_chatbot_id: args.chatbotId,
    p_query_embedding: toVectorLiteral(queryEmbedding),
    p_match_count: topK,
  })

  if (error) {
    throw new AppError(`Failed to retrieve rag chunks: ${error.message}`, 500)
  }

  const rows = (data ?? []) as RagMatchRow[]
  return rows.map((row) => ({
    chunkText: row.chunk_text,
    url: row.url,
    similarity: row.similarity,
  }))
}
