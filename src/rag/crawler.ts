import * as cheerio from 'cheerio'
import type { Browser } from 'playwright'

export type CrawledPage = {
  url: string
  title: string | null
  contentText: string
  httpStatus: number
}

type CrawlDiscoveryOptions = {
  websiteUrl: string
  maxPages: number
  fetchTimeoutMs?: number
}

type FetchPageOptions = {
  url: string
  fetchTimeoutMs?: number
}

const blockedPathFragments = [
  '/wp-admin',
  '/account',
  '/checkout',
  '/cart',
  '/login',
  '/signup',
  '/auth',
  '/admin',
]

const skipExtensions = new Set([
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.svg',
  '.webp',
  '.css',
  '.js',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.zip',
  '.mp4',
  '.mp3',
])

const jsRenderEnabled = process.env.RAG_JS_RENDER !== 'false'
const jsRenderTimeoutMs = Number(process.env.RAG_JS_RENDER_TIMEOUT_MS ?? 15_000)
const minimumUsefulTextLength = 120

let browserPromise: Promise<Browser | null> | null = null

function normalizeUrl(rawUrl: string, baseUrl?: string): string | null {
  try {
    const parsed = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl)
    parsed.hash = ''
    parsed.search = ''
    if (parsed.pathname.endsWith('/') && parsed.pathname !== '/') {
      parsed.pathname = parsed.pathname.slice(0, -1)
    }
    return parsed.toString()
  } catch {
    return null
  }
}

function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function shouldSkipUrl(url: string): boolean {
  const lower = url.toLowerCase()
  if (blockedPathFragments.some((fragment) => lower.includes(fragment))) {
    return true
  }

  for (const ext of skipExtensions) {
    if (lower.endsWith(ext)) {
      return true
    }
  }

  return false
}

function extractLocTags(xml: string): string[] {
  const matches = [...xml.matchAll(/<loc>(.*?)<\/loc>/gims)]
  return matches.map((item) => item[1]?.trim()).filter((value): value is string => Boolean(value))
}

async function fetchWithTimeout(url: string, timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'KufuBot/1.0 (+https://kufu.ai)',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchSitemapUrls(rootUrl: string, fetchTimeoutMs: number): Promise<string[]> {
  const sitemapUrl = normalizeUrl('/sitemap.xml', rootUrl)
  if (!sitemapUrl) {
    return []
  }

  try {
    const response = await fetchWithTimeout(sitemapUrl, fetchTimeoutMs)
    if (!response.ok) {
      return []
    }

    const xml = await response.text()
    const locs = extractLocTags(xml)
    return locs
  } catch {
    return []
  }
}

async function getPlaywrightBrowser(): Promise<Browser | null> {
  if (!jsRenderEnabled) return null

  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        const chromium = await import('@sparticuz/chromium')
        const { chromium: playwrightChromium } = await import('playwright-core')
        const browser = await playwrightChromium.launch({
          args: chromium.default.args,
          executablePath: await chromium.default.executablePath(),
          headless: true,
        })
        return browser
      } catch {
        return null
      }
    })()
  }

  return browserPromise
}

async function renderPageWithPlaywright(url: string): Promise<{
  html: string
  text: string
  links: string[]
} | null> {
  const browser = await getPlaywrightBrowser()
  if (!browser) {
    return null
  }

  const page = await browser.newPage({
    userAgent: 'KufuBot/1.0 (+https://kufu.ai)',
  })

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: jsRenderTimeoutMs,
    })
    await page.waitForLoadState('networkidle', {
      timeout: Math.min(4_000, jsRenderTimeoutMs),
    }).catch(() => undefined)

    const [html, text, links] = await Promise.all([
      page.content(),
      page.evaluate(() => document.body?.innerText?.replace(/\s+/g, ' ').trim() ?? ''),
      page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .map((anchor) => anchor.getAttribute('href') ?? '')
          .filter((href) => href.length > 0),
      ),
    ])

    return { html, text, links }
  } catch {
    return null
  } finally {
    await page.close().catch(() => undefined)
  }
}

function extractInternalLinks(html: string, pageUrl: string, rootHost: string): string[] {
  const $ = cheerio.load(html)
  const links: string[] = []

  $('a[href]').each((_index, element) => {
    const href = $(element).attr('href')
    if (!href) {
      return
    }

    const normalized = normalizeUrl(href, pageUrl)
    if (!normalized) {
      return
    }

    if (getHostname(normalized) !== rootHost) {
      return
    }

    if (shouldSkipUrl(normalized)) {
      return
    }

    links.push(normalized)
  })

  return links
}

export async function discoverWebsiteUrls(options: CrawlDiscoveryOptions): Promise<string[]> {
  const maxPages = Math.max(1, Math.min(options.maxPages, 200))
  const rootUrl = normalizeUrl(options.websiteUrl)
  if (!rootUrl) {
    throw new Error('Invalid website URL')
  }

  const rootHost = getHostname(rootUrl)
  if (!rootHost) {
    throw new Error('Invalid website host')
  }

  const fetchTimeoutMs = options.fetchTimeoutMs ?? 12_000
  const dedup = new Set<string>()

  const sitemapUrls = await fetchSitemapUrls(rootUrl, fetchTimeoutMs)
  for (const raw of sitemapUrls) {
    const normalized = normalizeUrl(raw)
    if (!normalized) {
      continue
    }
    if (getHostname(normalized) !== rootHost) {
      continue
    }
    if (shouldSkipUrl(normalized)) {
      continue
    }
    dedup.add(normalized)
    if (dedup.size >= maxPages) {
      return Array.from(dedup)
    }
  }

  if (dedup.size > 0) {
    return Array.from(dedup).slice(0, maxPages)
  }

  const queue: string[] = [rootUrl]
  dedup.add(rootUrl)
  const visited = new Set<string>()

  while (queue.length > 0 && dedup.size < maxPages) {
    const current = queue.shift()
    if (!current) {
      break
    }
    if (visited.has(current)) {
      continue
    }
    visited.add(current)

    try {
      const response = await fetchWithTimeout(current, fetchTimeoutMs)
      const contentType = response.headers.get('content-type') ?? ''
      if (!response.ok || !contentType.toLowerCase().includes('text/html')) {
        continue
      }

      const html = await response.text()
      let links = extractInternalLinks(html, current, rootHost)
      if (links.length === 0) {
        const rendered = await renderPageWithPlaywright(current)
        if (rendered) {
          links = rendered.links
            .map((href) => normalizeUrl(href, current))
            .filter((value): value is string => Boolean(value))
            .filter((url) => getHostname(url) === rootHost)
            .filter((url) => !shouldSkipUrl(url))
        }
      }

      for (const link of links) {
        if (dedup.has(link)) {
          continue
        }
        dedup.add(link)
        queue.push(link)
        if (dedup.size >= maxPages) {
          break
        }
      }
    } catch {
      continue
    }
  }

  return Array.from(dedup).slice(0, maxPages)
}

export async function fetchAndExtractPage(options: FetchPageOptions): Promise<CrawledPage> {
  const response = await fetchWithTimeout(options.url, options.fetchTimeoutMs ?? 12_000)
  const httpStatus = response.status

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('text/html')) {
    throw new Error(`Unsupported content-type: ${contentType || 'unknown'}`)
  }

  const html = await response.text()
  const $ = cheerio.load(html)
  $('script, style, noscript, svg').remove()

  const title = $('title').first().text().trim() || null
  const metaDescription =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    ''

  let contentText = $('body').text().replace(/\s+/g, ' ').trim()
  if (!contentText && metaDescription) {
    contentText = metaDescription
  }

  if (contentText.length < minimumUsefulTextLength) {
    const rendered = await renderPageWithPlaywright(options.url)
    if (rendered) {
      const renderedText = rendered.text.trim()
      if (renderedText.length > contentText.length) {
        contentText = renderedText
      }
    }
  }

  if (!contentText) {
    throw new Error('No extractable text content')
  }

  return {
    url: options.url,
    title,
    contentText,
    httpStatus,
  }
}
