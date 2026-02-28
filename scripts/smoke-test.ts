/* eslint-disable no-console */

const baseUrl = (process.env.SMOKE_BASE_URL || 'http://localhost:8787').replace(/\/+$/, '')
const bypassVerification = process.env.DEV_BYPASS_EMAIL_VERIFY === 'true'

function randomEmail() {
  return `smoke_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`
}

type RequestOptions = {
  method?: string
  body?: unknown
  token?: string
}

async function apiRequest(path: string, options: RequestOptions = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const text = await response.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = text
  }

  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${JSON.stringify(json)}`)
  }

  return json as Record<string, unknown>
}

async function runSmokeTest() {
  const email = randomEmail()
  const password = 'SmokeTest@12345'

  console.log('[smoke] baseUrl', baseUrl)
  console.log('[smoke] register', email)

  const registerResponse = await apiRequest('/api/auth/register', {
    body: {
      email,
      password,
      business_name: 'Smoke Test Business',
      website_url: 'https://example.com',
    },
  })

  const devToken = typeof registerResponse.devToken === 'string' ? registerResponse.devToken : null

  if (devToken) {
    console.log('[smoke] verify-email using dev token')
    await apiRequest('/api/auth/verify-email', {
      body: { token: devToken },
    })
  } else if (!bypassVerification) {
    throw new Error('No devToken returned. Set DEV_BYPASS_EMAIL_VERIFY=true or verify manually before running smoke test.')
  }

  console.log('[smoke] login')
  const loginResponse = await apiRequest('/api/auth/login', {
    body: { email, password },
  })

  const token = typeof loginResponse.token === 'string' ? loginResponse.token : null
  if (!token) {
    throw new Error('Login did not return token')
  }

  console.log('[smoke] create chatbot')
  const chatbotResponse = await apiRequest('/api/dashboard/chatbots', {
    token,
    body: {
      name: 'Smoke Bot',
      website_url: 'https://example.com',
      is_active: true,
    },
  })

  const chatbot = chatbotResponse.chatbot as { id?: string } | undefined
  if (!chatbot?.id) {
    throw new Error('Chatbot create did not return chatbot id')
  }

  for (let index = 1; index <= 3; index += 1) {
    console.log(`[smoke] chat call ${index}`)
    await apiRequest('/api/chat', {
      token,
      body: {
        chatbot_id: chatbot.id,
        sessionId: `smoke-session-${Date.now()}`,
        messages: [{ role: 'user', content: `Smoke test message ${index}` }],
      },
    })
  }

  const summaryResponse = await apiRequest('/api/dashboard/summary', { token })
  const summary = summaryResponse.summary as { total_messages_lifetime?: number } | undefined

  console.log('[smoke] summary', summary)
  if (!summary || typeof summary.total_messages_lifetime !== 'number' || summary.total_messages_lifetime < 3) {
    throw new Error('Usage counters did not increment as expected')
  }

  console.log('[smoke] success')
}

void runSmokeTest().catch((error) => {
  console.error('[smoke] failed', error)
  process.exit(1)
})
