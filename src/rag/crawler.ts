import axios from "axios";
import * as cheerio from "cheerio";
import type { Browser } from "playwright";

export type CrawledPage = {
  url: string;
  title: string | null;
  contentText: string;
  httpStatus: number;
};

type CrawlDiscoveryOptions = {
  websiteUrl: string;
  seedUrls?: string[];
  maxPages: number;
  fetchTimeoutMs?: number;
};

type FetchPageOptions = {
  url: string;
  fetchTimeoutMs?: number;
};

type HttpPageResponse = {
  status: number;
  contentType: string;
  html: string;
};

const blockedPathFragments = [
  "/wp-admin",
  "/account",
  "/checkout",
  "/cart",
  "/login",
  "/signup",
  "/auth",
  "/admin",
];

const skipExtensions = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".svg",
  ".webp",
  ".css",
  ".js",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".zip",
  ".mp4",
  ".mp3",
]);

const playwrightEnabled = process.env.ENABLE_PLAYWRIGHT === "true";
const jsRenderTimeoutMs = Number(
  process.env.RAG_JS_RENDER_TIMEOUT_MS ?? 15_000,
);
const thinContentThreshold = 300;

let browserPromise: Promise<Browser | null> | null = null;

function normalizeUrl(rawUrl: string, baseUrl?: string): string | null {
  try {
    const parsed = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
    parsed.hash = "";
    parsed.search = "";
    if (parsed.pathname.endsWith("/") && parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function shouldSkipUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (blockedPathFragments.some((fragment) => lower.includes(fragment))) {
    return true;
  }

  for (const ext of skipExtensions) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }

  return false;
}

function extractLocTags(xml: string): string[] {
  const matches = [...xml.matchAll(/<loc>(.*?)<\/loc>/gims)];
  return matches
    .map((item) => item[1]?.trim())
    .filter((value): value is string => Boolean(value));
}

async function fetchHtmlWithAxios(
  url: string,
  timeoutMs = 12_000,
): Promise<HttpPageResponse> {
  const response = await axios.get<string>(url, {
    timeout: timeoutMs,
    maxRedirects: 5,
    responseType: "text",
    headers: {
      "user-agent": "KufuBot/1.0 (+https://kufu.ai)",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    validateStatus: () => true,
  });

  return {
    status: response.status,
    contentType: String(response.headers["content-type"] ?? ""),
    html: typeof response.data === "string" ? response.data : "",
  };
}

async function fetchWithJina(url: string): Promise<string> {
  const response = await axios.get(`https://r.jina.ai/${url}`, {
    timeout: 30_000,
    headers: {
      Accept: "text/plain",
    },
  });
  return typeof response.data === "string" ? response.data : "";
}

function logPageEvent(args: {
  url: string;
  status: number;
  contentType: string;
  extractedLen: number;
  usedFallback: boolean;
  skipReason: string | null;
}) {
  console.info(
    `[rag] page url=${args.url} status=${args.status} content-type="${args.contentType || "unknown"}" extractedLen=${args.extractedLen} usedFallback=${args.usedFallback} skipReason=${args.skipReason ?? "none"}`,
  );
}

async function fetchSitemapUrls(
  rootUrl: string,
  fetchTimeoutMs: number,
): Promise<string[]> {
  const sitemapUrl = normalizeUrl("/sitemap.xml", rootUrl);
  if (!sitemapUrl) {
    return [];
  }

  try {
    const response = await axios.get<string>(sitemapUrl, {
      timeout: fetchTimeoutMs,
      responseType: "text",
      validateStatus: () => true,
      headers: {
        "user-agent": "KufuBot/1.0 (+https://kufu.ai)",
        accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (response.status < 200 || response.status >= 300) {
      return [];
    }

    const xml = typeof response.data === "string" ? response.data : "";
    return extractLocTags(xml);
  } catch {
    return [];
  }
}

async function getPlaywrightBrowser(): Promise<Browser | null> {
  if (!playwrightEnabled) {
    console.log("[playwright] disabled via env");
    return null;
  }

  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        const playwright = await import("playwright");
        const browser = await playwright.chromium.launch({
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage", // ADD THIS
            "--disable-gpu", // ADD THIS
            "--single-process", // ADD THIS
          ],
          headless: true,
        });
        console.log("[playwright] browser launched successfully");
        return browser;
      } catch (err) {
        console.log("[playwright] failed to launch:", err);
        return null;
      }
    })();
  }

  return browserPromise;
}

async function renderPageWithPlaywright(url: string): Promise<{
  text: string;
  links: string[];
} | null> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    console.log("[playwright] no browser available, skipping render");
    return null;
  }
  console.log("[playwright] rendering:", url);

  const page = await browser.newPage({
    userAgent: "KufuBot/1.0 (+https://kufu.ai)",
  });

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: jsRenderTimeoutMs,
    });
    await page
      .waitForLoadState("networkidle", {
        timeout: Math.min(4_000, jsRenderTimeoutMs),
      })
      .catch(() => undefined);

    const [text, links] = await Promise.all([
      page.evaluate(
        () => document.body?.innerText?.replace(/\s+/g, " ").trim() ?? "",
      ),
      page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]"))
          .map((anchor) => anchor.getAttribute("href") ?? "")
          .filter((href) => href.length > 0),
      ),
    ]);

    return { text, links };
  } catch {
    return null;
  } finally {
    await page.close().catch(() => undefined);
  }
}

function extractInternalLinks(
  html: string,
  pageUrl: string,
  rootHost: string,
): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];

  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }

    const normalized = normalizeUrl(href, pageUrl);
    if (!normalized) {
      return;
    }

    if (getHostname(normalized) !== rootHost) {
      return;
    }

    if (shouldSkipUrl(normalized)) {
      return;
    }

    links.push(normalized);
  });

  return links;
}

export async function discoverWebsiteUrls(
  options: CrawlDiscoveryOptions,
): Promise<string[]> {
  const maxPages = Math.max(1, Math.min(options.maxPages, 200));
  const rootUrl = normalizeUrl(options.websiteUrl);
  if (!rootUrl) {
    throw new Error("Invalid website URL");
  }

  const rootHost = getHostname(rootUrl);
  if (!rootHost) {
    throw new Error("Invalid website host");
  }

  const fetchTimeoutMs = options.fetchTimeoutMs ?? 12_000;
  const dedup = new Set<string>([rootUrl]);

  for (const rawSeed of options.seedUrls ?? []) {
    const normalized = normalizeUrl(rawSeed, rootUrl);
    if (!normalized) {
      continue;
    }
    if (getHostname(normalized) !== rootHost) {
      continue;
    }
    if (shouldSkipUrl(normalized)) {
      continue;
    }
    dedup.add(normalized);
    if (dedup.size >= maxPages) {
      return Array.from(dedup).slice(0, maxPages);
    }
  }

  const sitemapUrls = await fetchSitemapUrls(rootUrl, fetchTimeoutMs);
  for (const raw of sitemapUrls) {
    const normalized = normalizeUrl(raw, rootUrl);
    if (!normalized) {
      continue;
    }
    if (getHostname(normalized) !== rootHost) {
      continue;
    }
    if (shouldSkipUrl(normalized)) {
      continue;
    }
    dedup.add(normalized);
    if (dedup.size >= maxPages) {
      return Array.from(dedup).slice(0, maxPages);
    }
  }

  const queue: string[] = Array.from(dedup);
  const visited = new Set<string>();

  while (queue.length > 0 && dedup.size < maxPages) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    try {
      const response = await fetchHtmlWithAxios(current, fetchTimeoutMs);
      if (
        response.status < 200 ||
        response.status >= 300 ||
        !response.contentType.toLowerCase().includes("text/html")
      ) {
        continue;
      }

      let links = extractInternalLinks(response.html, current, rootHost);
      if (links.length === 0) {
        const rendered = await renderPageWithPlaywright(current);
        if (rendered) {
          links = rendered.links
            .map((href) => normalizeUrl(href, current))
            .filter((value): value is string => Boolean(value))
            .filter((url) => getHostname(url) === rootHost)
            .filter((url) => !shouldSkipUrl(url));
        }
      }

      for (const link of links) {
        if (dedup.has(link)) {
          continue;
        }
        dedup.add(link);
        queue.push(link);
        if (dedup.size >= maxPages) {
          break;
        }
      }
    } catch {
      continue;
    }
  }

  return Array.from(dedup).slice(0, maxPages);
}

export async function fetchAndExtractPage(
  options: FetchPageOptions,
): Promise<CrawledPage> {
  try {
    const contentText = await fetchWithJina(options.url);

    return {
      url: options.url,
      title: null,
      contentText: contentText || `Source URL: ${options.url}`,
      httpStatus: 200,
    };
  } catch (error) {
    throw new Error(`Failed to fetch: ${options.url}`);
  }
}
