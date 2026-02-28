export type Chunk = {
  chunk_index: number
  chunk_text: string
  token_estimate: number
}

type ChunkTextOptions = {
  chunkSize?: number
  overlap?: number
}

function normalizeContent(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

export function chunkText(input: string, options: ChunkTextOptions = {}): Chunk[] {
  const chunkSize = Math.max(300, Math.min(options.chunkSize ?? 1050, 2000))
  const overlap = Math.max(0, Math.min(options.overlap ?? 150, Math.floor(chunkSize / 2)))
  const text = normalizeContent(input)

  if (!text) {
    const placeholder = 'No textual content extracted from this page.'
    return [
      {
        chunk_index: 0,
        chunk_text: placeholder,
        token_estimate: estimateTokens(placeholder),
      },
    ]
  }

  const step = Math.max(1, chunkSize - overlap)
  const chunks: Chunk[] = []
  let index = 0

  for (let start = 0; start < text.length; start += step) {
    const rawChunk = text.slice(start, start + chunkSize).trim()
    if (!rawChunk) {
      continue
    }

    chunks.push({
      chunk_index: index,
      chunk_text: rawChunk,
      token_estimate: estimateTokens(rawChunk),
    })

    index += 1
    if (start + chunkSize >= text.length) {
      break
    }
  }

  return chunks
}
