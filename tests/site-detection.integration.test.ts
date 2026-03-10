import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildTestApp } from './helpers/buildTestApp.js';

async function loginWithCredentials(
  app: Parameters<typeof request>[0],
  email: string,
  password: string,
) {
  const response = await request(app).post('/api/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  return response.body.token as string;
}

describe('site detection routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires authentication for detection endpoints', async () => {
    const { app } = buildTestApp();

    const response = await request(app).post('/api/site-detection/detect').send({
      websiteUrl: 'https://example.com',
    });

    expect(response.status).toBe(401);
    expect(response.body.ok).toBe(false);
  });

  it('detects, stores metadata, and returns install guide with chatbot snippet', async () => {
    const { app, seed, supabase } = buildTestApp();
    const token = await loginWithCredentials(app, seed.starterUser.email, seed.starterUser.password);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        '<html><body><img src="/wp-content/plugins/foo.png" /><a href="/wp-json">api</a></body></html>',
        {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
          },
        },
      ),
    );

    const detectResponse = await request(app)
      .post('/api/site-detection/detect')
      .set('Authorization', `Bearer ${token}`)
      .send({
        websiteUrl: 'https://example.com',
        chatbotId: seed.starterUser.chatbotId,
      });

    expect(detectResponse.status).toBe(200);
    expect(detectResponse.body.ok).toBe(true);
    expect(detectResponse.body.websiteType).toBe('wordpress');
    expect(Array.isArray(detectResponse.body.signals)).toBe(true);

    const stored = await supabase
      .from('website_integrations')
      .select('user_id, chatbot_id, website_url, detected_type, detection_confidence, detection_signals')
      .eq('user_id', seed.starterUser.id)
      .eq('chatbot_id', seed.starterUser.chatbotId)
      .maybeSingle<{
        user_id: string;
        chatbot_id: string;
        website_url: string;
        detected_type: string;
        detection_confidence: string;
        detection_signals: string[];
      }>();

    expect(stored.error).toBeNull();
    expect(stored.data?.detected_type).toBe('wordpress');
    expect(stored.data?.website_url).toBe('https://example.com/');

    const guideResponse = await request(app)
      .get('/api/site-detection/install-guide')
      .query({
        websiteType: 'wordpress',
        chatbotId: seed.starterUser.chatbotId,
      })
      .set('Authorization', `Bearer ${token}`);

    expect(guideResponse.status).toBe(200);
    expect(guideResponse.body.ok).toBe(true);
    expect(guideResponse.body.title).toContain('WordPress');
    expect(Array.isArray(guideResponse.body.steps)).toBe(true);
    expect(String(guideResponse.body.scriptExample)).toContain('/widget/kufu.js?key=');
    expect(String(guideResponse.body.scriptExample)).not.toContain('YOUR_WIDGET_PUBLIC_KEY');
  });

  it('returns forbidden when user requests install guide for another user chatbot', async () => {
    const { app, seed } = buildTestApp();
    const token = await loginWithCredentials(app, seed.starterUser.email, seed.starterUser.password);

    const response = await request(app)
      .get('/api/site-detection/install-guide')
      .query({
        websiteType: 'react',
        chatbotId: seed.limitedUser.chatbotId,
      })
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.ok).toBe(false);
  });
});
