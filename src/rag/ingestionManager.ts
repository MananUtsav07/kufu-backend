import type OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AppError } from '../lib/errors.js'
import { chunkText } from './chunker.js'
import { discoverWebsiteUrls, fetchAndExtractPage } from './crawler.js'
import { embedTexts } from './embeddings.js'
import {
  clearChatbotRagData,
  createIngestionRun,
  failStuckIngestionRuns,
  findRunningIngestionForChatbot,
  getIngestionRunById,
  markPageFailure,
  replacePageChunks,
  updateIngestionRun,
  upsertPage,
} from './store.js'

type StartJobInput = {
  chatbotId: string
  websiteUrl: string
  maxPages: number
  urls?: string[]
  userId: string
  isResync: boolean
}

type JobState = {
  runId: string
  chatbotId: string
  status: 'running' | 'done' | 'failed' | 'canceled'
  pagesFound: number
  pagesCrawled: number
  chunksWritten: number
  error: string | null
  cancelRequested: boolean
  startedAt: string
  finishedAt: string | null
  updatedAt: string
}

const CRAWL_CONCURRENCY = 4
const FETCH_TIMEOUT_MS = 12_000

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'unknown error'
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0

  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) {
        break
      }
      await worker(items[index], index)
    }
  })

  await Promise.all(runners)
}

class RagIngestionManager {
  private readonly jobs = new Map<string, JobState>()

  constructor(
    private readonly supabaseAdminClient: SupabaseClient,
    private readonly openAiClient: OpenAI,
  ) {}

  private setJob(update: JobState) {
    this.jobs.set(update.runId, update)
  }

  async startJob(input: StartJobInput): Promise<{ runId: string }> {
    const running = await findRunningIngestionForChatbot(this.supabaseAdminClient, input.chatbotId)
    if (running) {
      throw new AppError('An ingestion is already running for this chatbot', 409, { runId: running.id })
    }

    const run = await createIngestionRun(this.supabaseAdminClient, {
      chatbotId: input.chatbotId,
      websiteUrl: input.websiteUrl,
      maxPages: input.maxPages,
      triggeredByUserId: input.userId,
    })

    const job: JobState = {
      runId: run.id,
      chatbotId: input.chatbotId,
      status: 'running',
      pagesFound: 0,
      pagesCrawled: 0,
      chunksWritten: 0,
      error: null,
      cancelRequested: false,
      startedAt: run.started_at,
      finishedAt: null,
      updatedAt: run.updated_at,
    }
    this.setJob(job)
    void this.processJob(job.runId, input)
    return { runId: run.id }
  }

  async getStatus(runId: string): Promise<JobState | null> {
    const memoryJob = this.jobs.get(runId)
    const dbRun = await getIngestionRunById(this.supabaseAdminClient, runId)
    if (!dbRun && !memoryJob) {
      return null
    }

    return {
      runId,
      chatbotId: dbRun?.chatbot_id ?? memoryJob?.chatbotId ?? '',
      status: (memoryJob?.status ?? dbRun?.status ?? 'failed') as JobState['status'],
      pagesFound: memoryJob?.pagesFound ?? dbRun?.pages_found ?? 0,
      pagesCrawled: memoryJob?.pagesCrawled ?? dbRun?.pages_crawled ?? 0,
      chunksWritten: memoryJob?.chunksWritten ?? dbRun?.chunks_written ?? 0,
      error: memoryJob?.error ?? dbRun?.error ?? null,
      cancelRequested: memoryJob?.cancelRequested ?? dbRun?.cancel_requested ?? false,
      startedAt: memoryJob?.startedAt ?? dbRun?.started_at ?? new Date().toISOString(),
      finishedAt: memoryJob?.finishedAt ?? dbRun?.finished_at ?? null,
      updatedAt: memoryJob?.updatedAt ?? dbRun?.updated_at ?? new Date().toISOString(),
    }
  }

  async cancel(runId: string): Promise<void> {
    const job = this.jobs.get(runId)
    if (job && job.status === 'running') {
      this.setJob({
        ...job,
        cancelRequested: true,
        updatedAt: new Date().toISOString(),
      })
    }

    await updateIngestionRun(this.supabaseAdminClient, runId, {
      cancel_requested: true,
    })
  }

  private async persistProgress(job: JobState): Promise<void> {
    await updateIngestionRun(this.supabaseAdminClient, job.runId, {
      status: job.status,
      pages_found: job.pagesFound,
      pages_crawled: job.pagesCrawled,
      chunks_written: job.chunksWritten,
      error: job.error,
      cancel_requested: job.cancelRequested,
      finished_at: job.finishedAt,
    })
  }

  private async shouldStop(runId: string): Promise<boolean> {
    const job = this.jobs.get(runId)
    if (job?.cancelRequested) {
      return true
    }

    const dbRun = await getIngestionRunById(this.supabaseAdminClient, runId)
    return Boolean(dbRun?.cancel_requested)
  }

  private async processJob(runId: string, input: StartJobInput): Promise<void> {
    const existing = this.jobs.get(runId)
    if (!existing) {
      return
    }

    try {
      if (input.isResync) {
        await clearChatbotRagData(this.supabaseAdminClient, input.chatbotId)
      }

      const urls = await discoverWebsiteUrls({
        websiteUrl: input.websiteUrl,
        maxPages: input.maxPages,
        seedUrls: input.urls ?? [],
        fetchTimeoutMs: FETCH_TIMEOUT_MS,
      })

      let job = this.jobs.get(runId)
      if (!job) {
        return
      }
      job = {
        ...job,
        pagesFound: urls.length,
        updatedAt: new Date().toISOString(),
      }
      this.setJob(job)
      await this.persistProgress(job)

      await runWithConcurrency(urls, CRAWL_CONCURRENCY, async (url) => {
        const current = this.jobs.get(runId)
        if (!current || current.status !== 'running') {
          return
        }

        if (await this.shouldStop(runId)) {
          const stopped = this.jobs.get(runId)
          if (!stopped) {
            return
          }
          this.setJob({
            ...stopped,
            cancelRequested: true,
            updatedAt: new Date().toISOString(),
          })
          return
        }

        try {
          const page = await fetchAndExtractPage({
            url,
            fetchTimeoutMs: FETCH_TIMEOUT_MS,
          })

          const pageResult = await upsertPage(this.supabaseAdminClient, {
            chatbotId: input.chatbotId,
            url: page.url,
            title: page.title,
            contentText: page.contentText,
            status: 'ok',
            httpStatus: page.httpStatus,
          })

          let chunksWrittenIncrement = 0
          if (pageResult.changed) {
            const chunks = chunkText(page.contentText, {
              chunkSize: 1050,
              overlap: 150,
            })

            if (chunks.length > 0) {
              const embeddings = await embedTexts(
                this.openAiClient,
                chunks.map((chunk) => chunk.chunk_text),
              )
              chunksWrittenIncrement = await replacePageChunks(this.supabaseAdminClient, {
                chatbotId: input.chatbotId,
                pageId: pageResult.pageId,
                chunks,
                embeddings,
              })
            } else {
              await replacePageChunks(this.supabaseAdminClient, {
                chatbotId: input.chatbotId,
                pageId: pageResult.pageId,
                chunks: [],
                embeddings: [],
              })
            }
          }

          const updatedJob = this.jobs.get(runId)
          if (!updatedJob) {
            return
          }
          const next = {
            ...updatedJob,
            pagesCrawled: updatedJob.pagesCrawled + 1,
            chunksWritten: updatedJob.chunksWritten + chunksWrittenIncrement,
            updatedAt: new Date().toISOString(),
          }
          this.setJob(next)
          await this.persistProgress(next)
        } catch (error) {
          const message = toMessage(error)
          await markPageFailure(this.supabaseAdminClient, {
            chatbotId: input.chatbotId,
            url,
            status: 'failed',
          })

          const updatedJob = this.jobs.get(runId)
          if (!updatedJob) {
            return
          }
          const next = {
            ...updatedJob,
            pagesCrawled: updatedJob.pagesCrawled + 1,
            error: updatedJob.error ?? message,
            updatedAt: new Date().toISOString(),
          }
          this.setJob(next)
          await this.persistProgress(next)
        }
      })

      const completed = this.jobs.get(runId)
      if (!completed) {
        return
      }

      const isCanceled = completed.cancelRequested || (await this.shouldStop(runId))
      if (completed.pagesCrawled === 0) {
        console.error(
          `[rag] ingestion run ${runId} finished with 0 crawled pages. websiteUrl=${input.websiteUrl} pagesFound=${completed.pagesFound}`,
        )
      }
      const finished: JobState = {
        ...completed,
        status: isCanceled ? 'canceled' : 'done',
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      this.setJob(finished)
      await this.persistProgress(finished)
    } catch (error) {
      const failed = this.jobs.get(runId)
      if (!failed) {
        return
      }
      const message = toMessage(error)
      const next: JobState = {
        ...failed,
        status: 'failed',
        error: message,
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      this.setJob(next)
      await this.persistProgress(next)
    }
  }

  async markStuckRunsAsFailed(): Promise<number> {
    const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString()
    const markedCount = await failStuckIngestionRuns(this.supabaseAdminClient, staleBefore)
    if (markedCount > 0) {
      for (const [runId, state] of this.jobs.entries()) {
        if (state.status === 'running' && state.updatedAt < staleBefore) {
          this.jobs.set(runId, {
            ...state,
            status: 'failed',
            error: 'Marked as failed by scheduler: stale heartbeat',
            finishedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
        }
      }
    }
    return markedCount
  }
}

let managerSingleton: RagIngestionManager | null = null
let schedulerStarted = false

export function createRagIngestionManager(
  supabaseAdminClient: SupabaseClient,
  openAiClient: OpenAI,
): RagIngestionManager {
  if (managerSingleton) {
    return managerSingleton
  }
  managerSingleton = new RagIngestionManager(supabaseAdminClient, openAiClient)
  return managerSingleton
}

export function startRagMaintenanceSchedulers(manager: RagIngestionManager): void {
  if (schedulerStarted) {
    return
  }
  schedulerStarted = true

  setInterval(async () => {
    try {
      const marked = await manager.markStuckRunsAsFailed()
      if (marked > 0) {
        console.warn(`[rag] marked ${marked} stuck ingestion run(s) as failed`)
      }
    } catch (error) {
      console.error('[rag] failed to run stuck ingestion cleanup', error)
    }
  }, 5 * 60_000)

  setInterval(() => {
    // Reserved for periodic automated re-sync policies.
  }, 60 * 60_000)
}
