import * as cheerio from 'cheerio'

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
      const links = extractInternalLinks(html, current, rootHost)
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
  $('script, style, nav, footer, header, aside, noscript, svg').remove()

  const title = $('title').first().text().trim() || null
  const contentText = $('body').text().replace(/\s+/g, ' ').trim()

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
