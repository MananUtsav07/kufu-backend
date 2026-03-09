import { describe, expect, it } from 'vitest'

import {
  LEAD_CAPTURE_ACKNOWLEDGEMENT,
  appendLeadCaptureAcknowledgement,
  upsertLeadFromMessage,
} from '../src/services/chatService.js'
import { createSeededSupabaseClient } from './helpers/inMemorySupabase.js'

async function listClientLeads(
  supabase: ReturnType<typeof createSeededSupabaseClient>['supabase'],
  clientId: string,
) {
  const { data, error } = await supabase
    .from('leads')
    .select('id, client_id, email, phone, need, source, status')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

describe('chatService lead capture', () => {
  it('captures when only email is present', async () => {
    const { supabase, seed } = createSeededSupabaseClient()
    const result = await upsertLeadFromMessage(supabase as never, {
      clientId: seed.starterUser.clientId,
      content: 'Hi, contact me at only-email@example.com',
      sessionId: 'email-only',
    })

    expect(result.captured).toBe(true)
    expect(result.email).toBe('only-email@example.com')
    expect(result.phone).toBeNull()

    const leads = await listClientLeads(supabase, seed.starterUser.clientId)
    expect(leads).toHaveLength(1)
    expect(leads[0].email).toBe('only-email@example.com')
    expect(leads[0].phone).toBeNull()
  })

  it('captures when only phone is present', async () => {
    const { supabase, seed } = createSeededSupabaseClient()
    const result = await upsertLeadFromMessage(supabase as never, {
      clientId: seed.starterUser.clientId,
      content: 'Call me on +91 98765 43210 for details',
      sessionId: 'phone-only',
    })

    expect(result.captured).toBe(true)
    expect(result.email).toBeNull()
    expect(result.phone).toBe('+919876543210')

    const leads = await listClientLeads(supabase, seed.starterUser.clientId)
    expect(leads).toHaveLength(1)
    expect(leads[0].email).toBeNull()
    expect(leads[0].phone).toBe('+919876543210')
  })

  it('captures when both email and phone are present', async () => {
    const { supabase, seed } = createSeededSupabaseClient()
    const result = await upsertLeadFromMessage(supabase as never, {
      clientId: seed.starterUser.clientId,
      content: 'Reach me on +1 (555) 901-2222 and both@example.com',
      sessionId: 'both',
    })

    expect(result.captured).toBe(true)
    expect(result.email).toBe('both@example.com')
    expect(result.phone).toBe('+15559012222')

    const leads = await listClientLeads(supabase, seed.starterUser.clientId)
    expect(leads).toHaveLength(1)
    expect(leads[0].email).toBe('both@example.com')
    expect(leads[0].phone).toBe('+15559012222')
  })

  it('does not capture when no contact details are present', async () => {
    const { supabase, seed } = createSeededSupabaseClient()
    const result = await upsertLeadFromMessage(supabase as never, {
      clientId: seed.starterUser.clientId,
      content: 'Can you explain pricing?',
      sessionId: 'no-contact',
    })

    expect(result.captured).toBe(false)
    expect(result.email).toBeNull()
    expect(result.phone).toBeNull()

    const leads = await listClientLeads(supabase, seed.starterUser.clientId)
    expect(leads).toHaveLength(0)
  })

  it('updates existing lead by email/phone without wiping known contact fields', async () => {
    const { supabase, seed } = createSeededSupabaseClient()

    await upsertLeadFromMessage(supabase as never, {
      clientId: seed.starterUser.clientId,
      content: 'first@example.com +91 90000 00000',
      sessionId: 'first',
    })

    await upsertLeadFromMessage(supabase as never, {
      clientId: seed.starterUser.clientId,
      content: 'first@example.com tomorrow at 5pm',
      sessionId: 'second',
    })

    const leads = await listClientLeads(supabase, seed.starterUser.clientId)
    expect(leads).toHaveLength(1)
    expect(leads[0].email).toBe('first@example.com')
    expect(leads[0].phone).toBe('+919000000000')
  })
})

describe('appendLeadCaptureAcknowledgement', () => {
  it('appends acknowledgement when lead is captured', () => {
    const reply = appendLeadCaptureAcknowledgement('Test reply', true)
    expect(reply).toContain('Test reply')
    expect(reply).toContain(LEAD_CAPTURE_ACKNOWLEDGEMENT)
  })

  it('does not append acknowledgement when lead is not captured', () => {
    const reply = appendLeadCaptureAcknowledgement('Test reply', false)
    expect(reply).toBe('Test reply')
  })
})
