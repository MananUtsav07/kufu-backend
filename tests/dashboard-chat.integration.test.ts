import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { buildTestApp } from './helpers/buildTestApp.js'

async function loginWithCredentials(app: Parameters<typeof request>[0], email: string, password: string) {
  const response = await request(app).post('/api/auth/login').send({ email, password })
  expect(response.status).toBe(200)
  return response.body.token as string
}

describe('dashboard, plans, and chat integration', () => {
  it('loads dashboard summary and key list endpoints for authenticated users', async () => {
    const { app, seed } = buildTestApp()
    const token = await loginWithCredentials(app, seed.starterUser.email, seed.starterUser.password)

    const summaryResponse = await request(app)
      .get('/api/dashboard/summary')
      .set('Authorization', `Bearer ${token}`)

    expect(summaryResponse.status).toBe(200)
    expect(summaryResponse.body.ok).toBe(true)
    expect(summaryResponse.body.summary.plan).toBe('starter')
    expect(summaryResponse.body.summary.integrations_used).toBeGreaterThan(0)

    const chatbotsResponse = await request(app)
      .get('/api/dashboard/chatbots')
      .set('Authorization', `Bearer ${token}`)

    expect(chatbotsResponse.status).toBe(200)
    expect(chatbotsResponse.body.ok).toBe(true)
    expect(Array.isArray(chatbotsResponse.body.chatbots)).toBe(true)
    expect(chatbotsResponse.body.chatbots[0]).toHaveProperty('widget_public_key')
  })

  it('enforces auth and plan gates for dashboard routes', async () => {
    const { app, seed } = buildTestApp()
    const token = await loginWithCredentials(app, seed.starterUser.email, seed.starterUser.password)

    const unauthorizedSummary = await request(app).get('/api/dashboard/summary')
    expect(unauthorizedSummary.status).toBe(401)
    expect(unauthorizedSummary.body.ok).toBe(false)

    const analyticsDenied = await request(app)
      .get(`/api/dashboard/analytics/${seed.starterUser.chatbotId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(analyticsDenied.status).toBe(403)
    expect(analyticsDenied.body.ok).toBe(false)
    expect(analyticsDenied.body.error).toBe('Access Denied')
  })

  it('returns plan metadata and blocks chat usage when limits are reached', async () => {
    const { app, seed } = buildTestApp()

    const starterToken = await loginWithCredentials(app, seed.starterUser.email, seed.starterUser.password)
    const planResponse = await request(app)
      .get('/api/dashboard/plan')
      .set('Authorization', `Bearer ${starterToken}`)

    expect(planResponse.status).toBe(200)
    expect(planResponse.body.ok).toBe(true)
    expect(planResponse.body.plan.code).toBe('starter')

    const limitedToken = await loginWithCredentials(app, seed.limitedUser.email, seed.limitedUser.password)
    const limitedChatResponse = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${limitedToken}`)
      .send({
        chatbot_id: seed.limitedUser.chatbotId,
        sessionId: 'limit-session',
        messages: [{ role: 'user', content: 'Can you help me?' }],
      })

    expect(limitedChatResponse.status).toBe(403)
    expect(limitedChatResponse.body.ok).toBe(false)
    expect(String(limitedChatResponse.body.error).toLowerCase()).toContain('lifetime cap')
  })

  it('accepts valid chat payloads and rejects invalid payloads', async () => {
    const { app } = buildTestApp({ openAiMode: 'disabled' })

    const validChatResponse = await request(app).post('/api/chat').send({
      sessionId: 'public-session',
      messages: [{ role: 'user', content: 'Hello there' }],
    })

    expect(validChatResponse.status).toBe(200)
    expect(validChatResponse.body.ok).toBe(true)
    expect(typeof validChatResponse.body.reply).toBe('string')

    const invalidChatResponse = await request(app).post('/api/chat').send({
      sessionId: 'bad-session',
      messages: [{ role: 'tool', content: 'invalid role' }],
    })

    expect(invalidChatResponse.status).toBe(400)
    expect(invalidChatResponse.body.ok).toBe(false)
    expect(typeof invalidChatResponse.body.requestId).toBe('string')
  })

  it('returns safe error envelope with requestId when chat handler fails', async () => {
    const { app } = buildTestApp({ openAiMode: 'throw' })

    const response = await request(app).post('/api/chat').send({
      sessionId: 'failing-session',
      messages: [{ role: 'user', content: 'Trigger failure' }],
    })

    expect(response.status).toBe(500)
    expect(response.body.ok).toBe(false)
    expect(response.body.error).toBe('Unhandled server error')
    expect(typeof response.body.requestId).toBe('string')
  })

  it('captures leads with contact info and appends acknowledgement to chat reply', async () => {
    const { app, seed } = buildTestApp({ openAiMode: 'success' })
    const token = await loginWithCredentials(app, seed.starterUser.email, seed.starterUser.password)

    const chatResponse = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        chatbot_id: seed.starterUser.chatbotId,
        sessionId: 'lead-capture-dashboard',
        messages: [{ role: 'user', content: 'My email is lead.person@example.com' }],
      })

    expect(chatResponse.status).toBe(200)
    expect(chatResponse.body.ok).toBe(true)
    expect(chatResponse.body.reply).toContain('Test reply')
    expect(chatResponse.body.reply).toContain('Our team will contact you shortly.')

    const leadsResponse = await request(app)
      .get('/api/dashboard/leads')
      .set('Authorization', `Bearer ${token}`)

    expect(leadsResponse.status).toBe(200)
    expect(leadsResponse.body.ok).toBe(true)
    expect(leadsResponse.body.leads).toHaveLength(1)
    expect(leadsResponse.body.leads[0].email).toBe('lead.person@example.com')

    const noContactResponse = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        chatbot_id: seed.starterUser.chatbotId,
        sessionId: 'no-lead-dashboard',
        messages: [{ role: 'user', content: 'Tell me about pricing' }],
      })

    expect(noContactResponse.status).toBe(200)
    expect(noContactResponse.body.reply).toBe('Test reply')
  })

  it('captures widget leads even when chatbot.client_id is null using owner client fallback', async () => {
    const { app, seed, supabase } = buildTestApp({ openAiMode: 'success' })
    const token = await loginWithCredentials(app, seed.starterUser.email, seed.starterUser.password)

    await supabase
      .from('chatbots')
      .update({ client_id: null })
      .eq('id', seed.starterUser.chatbotId)

    const chatbotLookup = await supabase
      .from('chatbots')
      .select('widget_public_key')
      .eq('id', seed.starterUser.chatbotId)
      .maybeSingle<{ widget_public_key: string }>()

    expect(chatbotLookup.error).toBeNull()
    const widgetKey = chatbotLookup.data?.widget_public_key
    expect(widgetKey).toBeTruthy()

    const widgetResponse = await request(app).post('/api/chat').send({
      key: widgetKey,
      sessionId: 'widget-fallback-client-id',
      messages: [{ role: 'user', content: 'Contact +1 212 555 0199 please' }],
    })

    expect(widgetResponse.status).toBe(200)
    expect(widgetResponse.body.ok).toBe(true)
    expect(widgetResponse.body.reply).toContain('Our team will contact you shortly.')

    const leadsResponse = await request(app)
      .get('/api/dashboard/leads')
      .set('Authorization', `Bearer ${token}`)

    expect(leadsResponse.status).toBe(200)
    expect(leadsResponse.body.leads).toHaveLength(1)
    expect(leadsResponse.body.leads[0].phone).toBe('+12125550199')
  })
})
