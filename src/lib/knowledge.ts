import { readFileSync } from 'node:fs'
import path from 'node:path'

const candidatePaths = [
  path.resolve(process.cwd(), 'data/knowledge.md'),
  path.resolve(process.cwd(), 'server/data/knowledge.md'),
  path.resolve(process.cwd(), 'data/kufu_knowledge.md'),
  path.resolve(process.cwd(), 'server/data/kufu_knowledge.md'),
]

export const KNOWLEDGE_PATH = candidatePaths[0]

export function loadKnowledge(): string {
  for (const filePath of candidatePaths) {
    try {
      return readFileSync(filePath, 'utf8')
    } catch {
      // Try next candidate path.
    }
  }

  return ''
}
