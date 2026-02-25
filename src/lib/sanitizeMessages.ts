type Role = 'user' | 'assistant'
type IncomingMessage = { role?: string; content?: unknown }

export type SanitizedMessage = { role: Role; content: string }

export function sanitizeMessages(input: unknown, maxMessages = 12): SanitizedMessage[] {
  if (!Array.isArray(input)) {
    return []
  }

  const allowed = new Set(['user', 'assistant'])
  const cleaned: SanitizedMessage[] = []

  for (const message of input as IncomingMessage[]) {
    const role = typeof message?.role === 'string' ? message.role.trim() : ''
    if (!allowed.has(role)) {
      continue
    }

    let content = ''
    if (typeof message?.content === 'string') {
      content = message.content
    } else if (message?.content != null) {
      content = String(message.content)
    }

    content = content.replace(/\u0000/g, '').trim()
    if (!content) {
      continue
    }

    if (content.length > 4000) {
      content = `${content.slice(0, 4000)}...`
    }

    cleaned.push({ role: role as Role, content })
  }

  return cleaned.slice(-maxMessages)
}
