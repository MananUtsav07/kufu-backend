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

type ExtractedHtmlContent = {
  title: string | null;
  text: string;
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

let browserPromise: Promise<Browser | null> | null = null;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hasHtmlContentType(contentType: string): boolean {
  const normalizedContentType = contentType.toLowerCase();
  return (
    normalizedContentType.includes("text/html") ||
    normalizedContentType.includes("application/xhtml+xml")
  );
}

function extractHtmlContent(html: string): ExtractedHtmlContent {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const titleText = normalizeWhitespace($("title").first().text());
  const bodyText = normalizeWhitespace($("body").text());

  return {
    title: titleText.length > 0 ? titleText : null,
    text: bodyText,
  };
}

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

async function fetchWithJina(url: string, timeoutMs = 30_000): Promise<string> {
  const jinaApiKey = process.env.JINA_API_KEY?.trim();
  const headers: Record<string, string> = {
    Accept: "text/plain",
  };

  if (jinaApiKey) {
    headers.Authorization = `Bearer ${jinaApiKey}`;
  }

  const response = await axios.get(`https://r.jina.ai/${url}`, {
    timeout: timeoutMs,
    headers,
  });

  return typeof response.data === "string" ? normalizeWhitespace(response.data) : "";
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
  const fetchTimeoutMs = options.fetchTimeoutMs ?? 12_000;

  console.info(`[rag] fetching url=${options.url}`);

  try {
    const contentText = await fetchWithJina(options.url, Math.max(fetchTimeoutMs, 20_000));
    if (contentText.length > 0) {
      console.info(
        `[rag] fetched via=jina url=${options.url} extractedLen=${contentText.length}`,
      );

      return {
        url: options.url,
        title: null,
        contentText,
        httpStatus: 200,
      };
    }

    console.warn(`[rag] empty jina response url=${options.url}`);
  } catch (error) {
    console.warn(
      `[rag] jina fetch failed url=${options.url} error=${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  try {
    const pageResponse = await fetchHtmlWithAxios(options.url, fetchTimeoutMs);
    if (
      pageResponse.status >= 200 &&
      pageResponse.status < 300 &&
      hasHtmlContentType(pageResponse.contentType)
    ) {
      const extracted = extractHtmlContent(pageResponse.html);
      if (extracted.text.length > 0) {
        console.info(
          `[rag] fetched via=direct-html url=${options.url} extractedLen=${extracted.text.length}`,
        );

        return {
          url: options.url,
          title: extracted.title,
          contentText: extracted.text,
          httpStatus: pageResponse.status,
        };
      }
    }

    console.warn(
      `[rag] direct html fetch produced no text url=${options.url} status=${pageResponse.status} contentType=${pageResponse.contentType}`,
    );
  } catch (error) {
    console.warn(
      `[rag] direct html fetch failed url=${options.url} error=${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  const rendered = await renderPageWithPlaywright(options.url);
  if (rendered?.text && normalizeWhitespace(rendered.text).length > 0) {
    const renderedText = normalizeWhitespace(rendered.text);
    console.info(
      `[rag] fetched via=playwright url=${options.url} extractedLen=${renderedText.length}`,
    );

    return {
      url: options.url,
      title: null,
      contentText: renderedText,
      httpStatus: 200,
    };
  }

  console.error(`[rag] failed url=${options.url} error=all fetch strategies exhausted`);
  throw new Error(`Failed to fetch: ${options.url}`);
}
