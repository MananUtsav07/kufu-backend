import { AppError } from '../lib/errors.js'

type GraphRequestInput = {
  graphApiVersion: string
  path: string
  accessToken?: string
  method?: 'GET' | 'POST'
  query?: Record<string, string>
  body?: Record<string, unknown>
}

type SubscribeWebhookInput = {
  graphApiVersion: string
  accessToken: string
  wabaId: string
  webhookUrl: string
  verifyToken: string
}

export type SubscribeWebhookResult = {
  ok: boolean
  message: string
  status: number | null
  payload: unknown
}

function normalizeGraphApiVersion(value: string): string {
  return value.trim().replace(/^v/i, '') || '22.0'
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function getByPath(payload: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = payload
  for (const key of path) {
    const record = asRecord(current)
    if (!record || !(key in record)) {
      return null
    }
    current = record[key]
  }
  return current
}

function collectNestedStringMatches(value: unknown, wantedKeys: Set<string>, output: string[]) {
  if (!value || typeof value !== 'object') {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectNestedStringMatches(item, wantedKeys, output)
    }
    return
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (wantedKeys.has(key)) {
      const normalized = normalizeString(nestedValue)
      if (normalized) {
        output.push(normalized)
      }
    }
    collectNestedStringMatches(nestedValue, wantedKeys, output)
  }
}

async function graphRequest(input: GraphRequestInput): Promise<{
  ok: boolean
  status: number
  payload: unknown
}> {
  const version = normalizeGraphApiVersion(input.graphApiVersion)
  const path = input.path.replace(/^\/+/, '')
  const url = new URL(`https://graph.facebook.com/v${version}/${path}`)

  if (input.query) {
    for (const [key, value] of Object.entries(input.query)) {
      url.searchParams.set(key, value)
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  if (input.accessToken) {
    headers.Authorization = `Bearer ${input.accessToken}`
  }

  let body: string | undefined
  if (input.body) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(input.body)
  }

  const response = await fetch(url, {
    method: input.method ?? 'GET',
    headers,
    body,
  })

  const payload = await response.json().catch(() => ({}))
  return {
    ok: response.ok,
    status: response.status,
    payload,
  }
}

export async function exchangeMetaCodeForAccessToken(args: {
  graphApiVersion: string
  appId: string
  appSecret: string
  redirectUri: string
  code: string
}): Promise<string> {
  if (!args.appId || !args.appSecret || !args.redirectUri) {
    throw new AppError('Missing Meta app credentials for code exchange', 500)
  }

  const response = await graphRequest({
    graphApiVersion: args.graphApiVersion,
    path: 'oauth/access_token',
    query: {
      client_id: args.appId,
      client_secret: args.appSecret,
      redirect_uri: args.redirectUri,
      code: args.code,
    },
  })

  if (!response.ok) {
    const errorMessage =
      normalizeString(
        getByPath(asRecord(response.payload) ?? {}, ['error', 'message']),
      ) ?? `HTTP ${response.status}`
    throw new AppError(`Failed to exchange Meta OAuth code: ${errorMessage}`, 502)
  }

  const payloadRecord = asRecord(response.payload) ?? {}
  const accessToken = normalizeString(payloadRecord.access_token)
  if (!accessToken) {
    throw new AppError('Meta OAuth response missing access token', 502)
  }

  return accessToken
}

export async function fetchMetaWabaPhoneNumbers(args: {
  graphApiVersion: string
  accessToken: string
  wabaId: string
}): Promise<Array<{ id: string; displayPhoneNumber: string | null }>> {
  const response = await graphRequest({
    graphApiVersion: args.graphApiVersion,
    path: `${encodeURIComponent(args.wabaId)}/phone_numbers`,
    accessToken: args.accessToken,
    query: {
      fields: 'id,display_phone_number,verified_name',
    },
  })

  if (!response.ok) {
    const errorMessage =
      normalizeString(
        getByPath(asRecord(response.payload) ?? {}, ['error', 'message']),
      ) ?? `HTTP ${response.status}`
    throw new AppError(`Failed to fetch WhatsApp phone numbers: ${errorMessage}`, 502)
  }

  const payloadRecord = asRecord(response.payload) ?? {}
  const data = Array.isArray(payloadRecord.data) ? payloadRecord.data : []
  const rows: Array<{ id: string; displayPhoneNumber: string | null }> = []

  for (const item of data) {
    const itemRecord = asRecord(item)
    if (!itemRecord) {
      continue
    }

    const id = normalizeString(itemRecord.id)
    if (!id) {
      continue
    }

    rows.push({
      id,
      displayPhoneNumber: normalizeString(itemRecord.display_phone_number),
    })
  }

  return rows
}

export async function subscribeMetaWabaWebhook(
  args: SubscribeWebhookInput,
): Promise<SubscribeWebhookResult> {
  const attempts: Array<Record<string, unknown>> = [
    {
      override_callback_uri: args.webhookUrl,
      verify_token: args.verifyToken,
    },
    {
      callback_url: args.webhookUrl,
      verify_token: args.verifyToken,
    },
    {},
  ]

  let latestFailure: SubscribeWebhookResult = {
    ok: false,
    message: 'Webhook subscription failed',
    status: null,
    payload: {},
  }

  for (const attempt of attempts) {
    const response = await graphRequest({
      graphApiVersion: args.graphApiVersion,
      path: `${encodeURIComponent(args.wabaId)}/subscribed_apps`,
      method: 'POST',
      accessToken: args.accessToken,
      body: attempt,
    })

    if (response.ok) {
      return {
        ok: true,
        message: 'Webhook subscribed successfully',
        status: response.status,
        payload: response.payload,
      }
    }

    const errorMessage =
      normalizeString(
        getByPath(asRecord(response.payload) ?? {}, ['error', 'message']),
      ) ?? `HTTP ${response.status}`

    latestFailure = {
      ok: false,
      message: `Webhook subscribe failed: ${errorMessage}`,
      status: response.status,
      payload: response.payload,
    }
  }

  return latestFailure
}

export function extractEmbeddedSignupData(payload: unknown): {
  businessAccountId: string | null
  phoneNumberId: string | null
  displayPhoneNumber: string | null
  phoneNumber: string | null
  accessToken: string | null
  oauthCode: string | null
} {
  const root = asRecord(payload) ?? {}

  const businessAccountCandidates: string[] = []
  const phoneNumberIdCandidates: string[] = []
  const displayPhoneCandidates: string[] = []
  const phoneCandidates: string[] = []
  const accessTokenCandidates: string[] = []
  const codeCandidates: string[] = []

  collectNestedStringMatches(
    root,
    new Set(['waba_id', 'whatsapp_business_account_id', 'business_account_id']),
    businessAccountCandidates,
  )
  collectNestedStringMatches(
    root,
    new Set(['phone_number_id', 'business_phone_number_id']),
    phoneNumberIdCandidates,
  )
  collectNestedStringMatches(
    root,
    new Set(['display_phone_number']),
    displayPhoneCandidates,
  )
  collectNestedStringMatches(
    root,
    new Set(['phone_number', 'phone']),
    phoneCandidates,
  )
  collectNestedStringMatches(
    root,
    new Set(['access_token']),
    accessTokenCandidates,
  )
  collectNestedStringMatches(root, new Set(['code']), codeCandidates)

  return {
    businessAccountId: businessAccountCandidates[0] ?? null,
    phoneNumberId: phoneNumberIdCandidates[0] ?? null,
    displayPhoneNumber: displayPhoneCandidates[0] ?? null,
    phoneNumber: phoneCandidates[0] ?? null,
    accessToken: accessTokenCandidates[0] ?? null,
    oauthCode: codeCandidates[0] ?? null,
  }
}
