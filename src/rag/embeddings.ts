import type OpenAI from 'openai'

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_BATCH_SIZE = 32
const MAX_RETRIES = 5

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function shouldRetry(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const candidate = error as { status?: number; code?: string }
  const status = candidate.status ?? 0
  if (status === 429 || status >= 500) {
    return true
  }

  return candidate.code === 'ETIMEDOUT' || candidate.code === 'ECONNRESET'
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let attempt = 0
  let lastError: unknown

  while (attempt < MAX_RETRIES) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      attempt += 1

      if (attempt >= MAX_RETRIES || !shouldRetry(error)) {
        throw error
      }

      const backoffMs = 400 * (2 ** (attempt - 1))
      const jitterMs = Math.floor(Math.random() * 120)
      await sleep(backoffMs + jitterMs)
    }
  }

  throw lastError
}

export async function embedText(openAiClient: OpenAI, text: string): Promise<number[]> {
  const response = await withRetry(() =>
    openAiClient.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  )

  return response.data[0]?.embedding ?? []
}

export async function embedTexts(openAiClient: OpenAI, texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = []

  for (let index = 0; index < texts.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(index, index + EMBEDDING_BATCH_SIZE)
    if (batch.length === 0) {
      continue
    }

    const response = await withRetry(() =>
      openAiClient.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch,
      }),
    )

    for (const row of response.data) {
      embeddings.push(row.embedding)
    }
  }

  return embeddings
}
