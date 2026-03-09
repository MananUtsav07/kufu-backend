type LogLevel = 'info' | 'warn' | 'error'

type LogPayload = Record<string, unknown>

function write(level: LogLevel, payload: LogPayload): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    ...payload,
  }

  const serialized = JSON.stringify(logEntry)
  if (level === 'error') {
    console.error(serialized)
    return
  }

  if (level === 'warn') {
    console.warn(serialized)
    return
  }

  console.log(serialized)
}

export function logInfo(payload: LogPayload): void {
  write('info', payload)
}

export function logWarn(payload: LogPayload): void {
  write('warn', payload)
}

export function logError(payload: LogPayload): void {
  write('error', payload)
}
