import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AppError } from '../lib/errors.js'
import type { Chunk } from './chunker.js'

type RagPageRow = {
  id: string
  chatbot_id: string
  url: string
  content_hash: string | null
}

type RagIngestionRunRow = {
  id: string
  chatbot_id: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'done' | 'failed' | 'canceled'
  pages_found: number
  pages_crawled: number
  chunks_written: number
  error: string | null
  cancel_requested: boolean
  updated_at: string
  website_url: string | null
  max_pages: number | null
}

export function computeContentHash(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}

export async function createIngestionRun(
  supabaseAdminClient: SupabaseClient,
  args: {
    chatbotId: string
    websiteUrl: string
    maxPages: number
    triggeredByUserId: string
  },
): Promise<RagIngestionRunRow> {
  const { data, error } = await supabaseAdminClient
    .from('rag_ingestion_runs')
    .insert({
      chatbot_id: args.chatbotId,
      status: 'running',
      website_url: args.websiteUrl,
      max_pages: args.maxPages,
      triggered_by_user_id: args.triggeredByUserId,
      pages_found: 0,
      pages_crawled: 0,
      chunks_written: 0,
      cancel_requested: false,
      updated_at: new Date().toISOString(),
    })
    .select('id, chatbot_id, started_at, finished_at, status, pages_found, pages_crawled, chunks_written, error, cancel_requested, updated_at, website_url, max_pages')
    .single<RagIngestionRunRow>()

  if (error || !data) {
    throw new AppError(`Failed to create ingestion run: ${error?.message ?? 'unknown error'}`, 500)
  }

  return data
}

export async function findRunningIngestionForChatbot(
  supabaseAdminClient: SupabaseClient,
  chatbotId: string,
): Promise<RagIngestionRunRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('rag_ingestion_runs')
    .select('id, chatbot_id, started_at, finished_at, status, pages_found, pages_crawled, chunks_written, error, cancel_requested, updated_at, website_url, max_pages')
    .eq('chatbot_id', chatbotId)
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle<RagIngestionRunRow>()

  if (error) {
    throw new AppError(`Failed to load running ingestion: ${error.message}`, 500)
  }

  return data ?? null
}

export async function getIngestionRunById(
  supabaseAdminClient: SupabaseClient,
  runId: string,
): Promise<RagIngestionRunRow | null> {
  const { data, error } = await supabaseAdminClient
    .from('rag_ingestion_runs')
    .select('id, chatbot_id, started_at, finished_at, status, pages_found, pages_crawled, chunks_written, error, cancel_requested, updated_at, website_url, max_pages')
    .eq('id', runId)
    .maybeSingle<RagIngestionRunRow>()

  if (error) {
    throw new AppError(`Failed to load ingestion run: ${error.message}`, 500)
  }

  return data ?? null
}

export async function updateIngestionRun(
  supabaseAdminClient: SupabaseClient,
  runId: string,
  payload: Partial<{
    status: 'running' | 'done' | 'failed' | 'canceled'
    pages_found: number
    pages_crawled: number
    chunks_written: number
    error: string | null
    cancel_requested: boolean
    finished_at: string | null
  }>,
): Promise<void> {
  const updatePayload = {
    ...payload,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabaseAdminClient
    .from('rag_ingestion_runs')
    .update(updatePayload)
    .eq('id', runId)

  if (error) {
    throw new AppError(`Failed to update ingestion run: ${error.message}`, 500)
  }
}

export async function upsertPage(
  supabaseAdminClient: SupabaseClient,
  args: {
    chatbotId: string
    url: string
    title: string | null
    contentText: string
    status?: string
    httpStatus?: number
  },
): Promise<{ pageId: string; changed: boolean }> {
  const hash = computeContentHash(args.contentText)

  const { data: existing, error: existingError } = await supabaseAdminClient
    .from('rag_pages')
    .select('id, chatbot_id, url, content_hash')
    .eq('chatbot_id', args.chatbotId)
    .eq('url', args.url)
    .maybeSingle<RagPageRow>()

  if (existingError) {
    throw new AppError(`Failed to read existing page row: ${existingError.message}`, 500)
  }

  const now = new Date().toISOString()
  if (existing) {
    const changed = existing.content_hash !== hash
    const { error: updateError } = await supabaseAdminClient
      .from('rag_pages')
      .update({
        title: args.title,
        content_text: args.contentText,
        content_hash: hash,
        last_crawled_at: now,
        status: args.status ?? 'ok',
        http_status: args.httpStatus ?? null,
        updated_at: now,
      })
      .eq('id', existing.id)

    if (updateError) {
      throw new AppError(`Failed to update rag page: ${updateError.message}`, 500)
    }

    return { pageId: existing.id, changed }
  }

  const { data: created, error: createError } = await supabaseAdminClient
    .from('rag_pages')
    .insert({
      chatbot_id: args.chatbotId,
      url: args.url,
      title: args.title,
      content_text: args.contentText,
      content_hash: hash,
      last_crawled_at: now,
      status: args.status ?? 'ok',
      http_status: args.httpStatus ?? null,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single<{ id: string }>()

  if (createError || !created) {
    throw new AppError(`Failed to insert rag page: ${createError?.message ?? 'unknown error'}`, 500)
  }

  return { pageId: created.id, changed: true }
}

export async function markPageFailure(
  supabaseAdminClient: SupabaseClient,
  args: {
    chatbotId: string
    url: string
    status: string
    httpStatus?: number
  },
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabaseAdminClient
    .from('rag_pages')
    .upsert(
      {
        chatbot_id: args.chatbotId,
        url: args.url,
        status: args.status,
        http_status: args.httpStatus ?? null,
        last_crawled_at: now,
        updated_at: now,
      },
      {
        onConflict: 'chatbot_id,url',
      },
    )

  if (error) {
    throw new AppError(`Failed to mark page failure: ${error.message}`, 500)
  }
}

export async function replacePageChunks(
  supabaseAdminClient: SupabaseClient,
  args: {
    chatbotId: string
    pageId: string
    chunks: Chunk[]
    embeddings: number[][]
  },
): Promise<number> {
  if (args.chunks.length !== args.embeddings.length) {
    throw new AppError('Chunk and embedding count mismatch', 500)
  }

  const { error: deleteError } = await supabaseAdminClient
    .from('rag_chunks')
    .delete()
    .eq('page_id', args.pageId)

  if (deleteError) {
    throw new AppError(`Failed to delete existing chunks: ${deleteError.message}`, 500)
  }

  if (args.chunks.length === 0) {
    return 0
  }

  const rows = args.chunks.map((chunk, index) => ({
    chatbot_id: args.chatbotId,
    page_id: args.pageId,
    chunk_index: chunk.chunk_index,
    chunk_text: chunk.chunk_text,
    token_estimate: chunk.token_estimate,
    embedding: toVectorLiteral(args.embeddings[index]),
  }))

  const { error: insertError } = await supabaseAdminClient
    .from('rag_chunks')
    .insert(rows)

  if (insertError) {
    throw new AppError(`Failed to insert rag chunks: ${insertError.message}`, 500)
  }

  return rows.length
}

export async function clearChatbotRagData(
  supabaseAdminClient: SupabaseClient,
  chatbotId: string,
): Promise<void> {
  const { error: chunksError } = await supabaseAdminClient
    .from('rag_chunks')
    .delete()
    .eq('chatbot_id', chatbotId)

  if (chunksError) {
    throw new AppError(`Failed to clear rag chunks: ${chunksError.message}`, 500)
  }

  const { error: pagesError } = await supabaseAdminClient
    .from('rag_pages')
    .delete()
    .eq('chatbot_id', chatbotId)

  if (pagesError) {
    throw new AppError(`Failed to clear rag pages: ${pagesError.message}`, 500)
  }
}

export async function failStuckIngestionRuns(
  supabaseAdminClient: SupabaseClient,
  staleBeforeIso: string,
): Promise<number> {
  const { data, error } = await supabaseAdminClient
    .from('rag_ingestion_runs')
    .update({
      status: 'failed',
      error: 'Marked as failed by scheduler: stale heartbeat',
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'running')
    .lt('updated_at', staleBeforeIso)
    .select('id')

  if (error) {
    throw new AppError(`Failed to mark stuck runs: ${error.message}`, 500)
  }

  return data?.length ?? 0
}
