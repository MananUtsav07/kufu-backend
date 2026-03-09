import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { buildTestApp } from './helpers/buildTestApp.js'

async function loginWithCredentials(app: Parameters<typeof request>[0], email: string, password: string) {
  const response = await request(app).post('/api/auth/login').send({ email, password })
  expect(response.status).toBe(200)
  expect(response.body.ok).toBe(true)
  expect(typeof response.body.token).toBe('string')
  return response.body.token as string
}

describe('auth integration', () => {
  it('supports register -> verify -> login -> me flow', async () => {
    const { app } = buildTestApp()
    const email = `new-user-${Date.now()}@example.com`
    const password = 'StrongPass@1234'

    const registerResponse = await request(app).post('/api/auth/register').send({
      email,
      password,
      full_name: 'New User',
      business_name: 'New Business',
      website_url: 'https://new.example.com',
    })

    expect(registerResponse.status).toBe(201)
    expect(registerResponse.body.ok).toBe(true)
    expect(typeof registerResponse.body.devToken).toBe('string')

    const verifyResponse = await request(app).post('/api/auth/verify-email').send({
      token: registerResponse.body.devToken,
    })

    expect(verifyResponse.status).toBe(200)
    expect(verifyResponse.body.ok).toBe(true)

    const loginResponse = await request(app).post('/api/auth/login').send({
      email,
      password,
    })

    expect(loginResponse.status).toBe(200)
    expect(loginResponse.body.ok).toBe(true)
    expect(loginResponse.body.user.email).toBe(email)
    expect(loginResponse.body.client.plan).toBe('free')
    expect(loginResponse.body.plan.code).toBe('free')

    const token = loginResponse.body.token as string
    const meResponse = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)

    expect(meResponse.status).toBe(200)
    expect(meResponse.body.ok).toBe(true)
    expect(meResponse.body.user.email).toBe(email)
  })

  it('blocks unauthenticated and invalid-token access to protected auth route', async () => {
    const { app } = buildTestApp()

    const unauthenticated = await request(app).get('/api/auth/me')
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.body.ok).toBe(false)
    expect(unauthenticated.body.error).toBe('Unauthorized')
    expect(typeof unauthenticated.body.requestId).toBe('string')

    const invalidToken = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid.token.value')

    expect(invalidToken.status).toBe(401)
    expect(invalidToken.body.ok).toBe(false)
    expect(invalidToken.body.error).toBe('Unauthorized')
    expect(typeof invalidToken.body.requestId).toBe('string')
  })

  it('enforces admin-only access on admin routes', async () => {
    const { app, seed } = buildTestApp()

    const userToken = await loginWithCredentials(app, seed.starterUser.email, seed.starterUser.password)
    const adminToken = await loginWithCredentials(app, seed.adminUser.email, seed.adminUser.password)

    const blockedResponse = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${userToken}`)

    expect(blockedResponse.status).toBe(403)
    expect(blockedResponse.body.ok).toBe(false)
    expect(blockedResponse.body.error).toBe('Admin access required')
    expect(typeof blockedResponse.body.requestId).toBe('string')

    const adminResponse = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(adminResponse.status).toBe(200)
    expect(adminResponse.body.ok).toBe(true)
    expect(Array.isArray(adminResponse.body.users)).toBe(true)
    expect(adminResponse.body.users.length).toBeGreaterThan(0)
  })
})
