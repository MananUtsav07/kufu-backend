import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

type DataStoreOptions = {
  dataDir: string
  loadKnowledge: () => string
}

export type DataStore = {
  ensureInitialized: () => Promise<void>
  appendJsonLine: (fileName: string, payload: unknown) => Promise<void>
  getKnowledgeText: () => Promise<string>
}

export function createDataStore({ dataDir, loadKnowledge }: DataStoreOptions): DataStore {
  let knowledgeText = ''
  let initPromise: Promise<void> | null = null

  const ensureInitialized = async (): Promise<void> => {
    if (!initPromise) {
      initPromise = (async () => {
        await mkdir(dataDir, { recursive: true })
        knowledgeText = loadKnowledge()
      })()
    }

    await initPromise
  }

  const appendJsonLine = async (fileName: string, payload: unknown): Promise<void> => {
    await ensureInitialized()
    const line = `${JSON.stringify(payload)}\n`
    await appendFile(path.join(dataDir, fileName), line, 'utf8')
  }

  const getKnowledgeText = async (): Promise<string> => {
    await ensureInitialized()
    return knowledgeText
  }

  return {
    ensureInitialized,
    appendJsonLine,
    getKnowledgeText,
  }
}

