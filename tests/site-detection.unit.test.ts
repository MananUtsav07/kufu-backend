import { describe, expect, it } from 'vitest';

import { detectWebsiteTypeFromDocument } from '../src/services/siteDetection/detectWebsiteType.js';

describe('site detection heuristics', () => {
  it('detects wordpress markers with high confidence', () => {
    const result = detectWebsiteTypeFromDocument({
      url: 'https://example.com',
      headers: {},
      html: '<html><body><img src="/wp-content/uploads/logo.png" /><a href="/wp-json">api</a></body></html>',
    });

    expect(result.websiteType).toBe('wordpress');
    expect(result.confidence).toBe('high');
    expect(result.signals).toContain('wp-content');
  });

  it('detects nextjs markers', () => {
    const result = detectWebsiteTypeFromDocument({
      url: 'https://example.com',
      headers: {},
      html: '<script id="__NEXT_DATA__">{}</script><script src="/_next/static/chunks/main.js"></script>',
    });

    expect(result.websiteType).toBe('nextjs');
    expect(['high', 'medium']).toContain(result.confidence);
  });

  it('detects shopify via header and html markers', () => {
    const result = detectWebsiteTypeFromDocument({
      url: 'https://shop.example.com',
      headers: {
        'x-shopify-shop-domain': 'shop.example.com',
      },
      html: '<script src="https://cdn.shopify.com/shopifycloud/storefront.js"></script>',
    });

    expect(result.websiteType).toBe('shopify');
    expect(result.signals).toContain('cdn.shopify.com');
  });

  it('falls back to custom for unknown reachable websites', () => {
    const result = detectWebsiteTypeFromDocument({
      url: 'https://custom.example.com',
      headers: {},
      html: '<html><body><h1>Custom site</h1></body></html>',
    });

    expect(result.websiteType).toBe('custom');
    expect(result.confidence).toBe('low');
  });
});
