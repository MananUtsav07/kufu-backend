export type WebsiteType =
  | 'wordpress'
  | 'shopify'
  | 'react'
  | 'nextjs'
  | 'webflow'
  | 'wix'
  | 'squarespace'
  | 'custom'
  | 'unknown';

export type DetectionConfidence = 'high' | 'medium' | 'low';

export type SiteDetectionResult = {
  websiteType: WebsiteType;
  confidence: DetectionConfidence;
  signals: string[];
};

type SignalCandidate = {
  websiteType: Exclude<WebsiteType, 'custom' | 'unknown'>;
  marker: string;
  score: number;
};

type DetectFromDocumentInput = {
  url: string;
  html: string;
  headers: Record<string, string>;
};

const MAX_HTML_BYTES = 350_000;
const DETECTION_TIMEOUT_MS = 8_000;

const strongSignalCandidates: SignalCandidate[] = [
  { websiteType: 'wordpress', marker: 'wp-content', score: 5 },
  { websiteType: 'wordpress', marker: '/wp-json', score: 5 },
  { websiteType: 'wordpress', marker: 'wp-includes', score: 3 },
  { websiteType: 'shopify', marker: 'cdn.shopify.com', score: 5 },
  { websiteType: 'shopify', marker: 'shopify.theme', score: 5 },
  { websiteType: 'shopify', marker: 'myshopify.com', score: 3 },
  { websiteType: 'nextjs', marker: '__next_data__', score: 6 },
  { websiteType: 'nextjs', marker: '/_next/static', score: 5 },
  { websiteType: 'nextjs', marker: '__next', score: 3 },
  { websiteType: 'webflow', marker: 'w-webflow', score: 6 },
  { websiteType: 'webflow', marker: 'webflow.js', score: 5 },
  { websiteType: 'wix', marker: 'static.parastorage.com', score: 6 },
  { websiteType: 'wix', marker: 'wix.com', score: 3 },
  { websiteType: 'wix', marker: 'wix-bi-session', score: 5 },
  { websiteType: 'squarespace', marker: 'static1.squarespace.com', score: 6 },
  { websiteType: 'squarespace', marker: 'squarespace.com', score: 3 },
];

const mediumSignalCandidates: SignalCandidate[] = [
  { websiteType: 'react', marker: 'data-reactroot', score: 4 },
  { websiteType: 'react', marker: 'react-refresh', score: 3 },
  { websiteType: 'react', marker: '/static/js/main.', score: 2 },
  { websiteType: 'react', marker: 'id="root"', score: 2 },
  { websiteType: 'react', marker: 'id=\'root\'', score: 2 },
  { websiteType: 'react', marker: 'id="app"', score: 1 },
  { websiteType: 'wordpress', marker: 'generator" content="wordpress', score: 4 },
  { websiteType: 'webflow', marker: 'generator" content="webflow', score: 4 },
  { websiteType: 'wix', marker: 'generator" content="wix', score: 4 },
  { websiteType: 'squarespace', marker: 'generator" content="squarespace', score: 4 },
  { websiteType: 'shopify', marker: 'x-shopify', score: 4 },
  { websiteType: 'wordpress', marker: 'x-pingback', score: 4 },
];

export function normalizeWebsiteUrl(websiteUrl: string): string {
  const trimmed = websiteUrl.trim();
  if (!trimmed) {
    throw new Error('Website URL is required');
  }

  try {
    return new URL(trimmed).toString();
  } catch {
    return new URL(`https://${trimmed}`).toString();
  }
}

function buildSearchBlob(input: DetectFromDocumentInput): string {
  const headerText = Object.entries(input.headers)
    .map(([key, value]) => `${key}:${value}`)
    .join('\n');

  return `${input.url}\n${headerText}\n${input.html}`.toLowerCase();
}

function scoreSignals(
  searchBlob: string,
): {
  scores: Record<Exclude<WebsiteType, 'custom' | 'unknown'>, number>;
  matchedSignals: string[];
} {
  const scores: Record<Exclude<WebsiteType, 'custom' | 'unknown'>, number> = {
    wordpress: 0,
    shopify: 0,
    react: 0,
    nextjs: 0,
    webflow: 0,
    wix: 0,
    squarespace: 0,
  };

  const matchedSignals = new Set<string>();
  const signalCandidates = [...strongSignalCandidates, ...mediumSignalCandidates];

  for (const candidate of signalCandidates) {
    if (!searchBlob.includes(candidate.marker)) {
      continue;
    }

    scores[candidate.websiteType] += candidate.score;
    matchedSignals.add(candidate.marker);
  }

  return {
    scores,
    matchedSignals: Array.from(matchedSignals),
  };
}

function determineConfidence(topScore: number, secondScore: number): DetectionConfidence {
  if (topScore >= 7 || (topScore >= 6 && topScore - secondScore >= 3)) {
    return 'high';
  }

  if (topScore >= 4) {
    return 'medium';
  }

  return 'low';
}

export function detectWebsiteTypeFromDocument(input: DetectFromDocumentInput): SiteDetectionResult {
  const searchBlob = buildSearchBlob(input);
  const { scores, matchedSignals } = scoreSignals(searchBlob);

  const sortedScores = Object.entries(scores)
    .map(([websiteType, score]) => ({ websiteType: websiteType as Exclude<WebsiteType, 'custom' | 'unknown'>, score }))
    .sort((left, right) => right.score - left.score);

  const topCandidate = sortedScores[0];
  const secondCandidate = sortedScores[1];

  if (!topCandidate || topCandidate.score <= 0) {
    return {
      websiteType: 'custom',
      confidence: 'low',
      signals: matchedSignals,
    };
  }

  return {
    websiteType: topCandidate.websiteType,
    confidence: determineConfidence(topCandidate.score, secondCandidate?.score ?? 0),
    signals: matchedSignals,
  };
}

async function readBodyPreview(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (receivedBytes < maxBytes) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }

    const bytes = chunk.value;
    if (!bytes || bytes.length === 0) {
      continue;
    }

    const remaining = maxBytes - receivedBytes;
    const bounded = bytes.length > remaining ? bytes.subarray(0, remaining) : bytes;
    chunks.push(bounded);
    receivedBytes += bounded.length;

    if (bytes.length > remaining) {
      break;
    }
  }

  try {
    await reader.cancel();
  } catch {
    // Ignore read cancel failures.
  }

  const buffer = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
}

export async function detectWebsiteTypeFromUrl(websiteUrl: string): Promise<SiteDetectionResult> {
  const normalizedUrl = normalizeWebsiteUrl(websiteUrl);
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), DETECTION_TIMEOUT_MS);

  try {
    const response = await fetch(normalizedUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: timeoutController.signal,
      headers: {
        'User-Agent': 'KufuSiteDetection/1.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const html = await readBodyPreview(response, MAX_HTML_BYTES);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const detection = detectWebsiteTypeFromDocument({
      url: normalizedUrl,
      html,
      headers,
    });

    if (!response.ok) {
      return {
        ...detection,
        confidence: detection.websiteType === 'custom' ? 'low' : detection.confidence,
        signals: [`http_status:${response.status}`, ...detection.signals],
      };
    }

    return detection;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'fetch_failed';
    return {
      websiteType: 'unknown',
      confidence: 'low',
      signals: [`fetch_failed:${reason}`],
    };
  } finally {
    clearTimeout(timeout);
  }
}
