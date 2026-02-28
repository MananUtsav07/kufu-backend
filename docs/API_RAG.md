# RAG API (Render Deployment)

This backend assumes Render long-running Node deployment. RAG ingestion runs in background jobs (in-memory queue + persisted progress in `rag_ingestion_runs`).

## Overview

Per chatbot flow:

1. Crawl website pages (`websiteUrl`) with internal-link discovery and sitemap support.
2. Clean HTML to text.
3. Chunk text (about 1050 chars, 150 overlap).
4. Create embeddings (`text-embedding-3-small`).
5. Store pages/chunks in Supabase Postgres + pgvector.
6. At chat time: embed user query, retrieve top chunks, inject as context, then ask LLM.

## Endpoints

All routes below are protected (dashboard auth required).

### Start ingestion

- `POST /api/rag/ingest/start`
- Body:

```json
{
  "chatbotId": "uuid",
  "websiteUrl": "https://example.com",
  "maxPages": 60
}
```

- Response (`202`):

```json
{
  "ok": true,
  "runId": "uuid",
  "status": "running"
}
```

### Re-sync ingestion

- `POST /api/rag/ingest/resync`
- Body:

```json
{
  "chatbotId": "uuid",
  "websiteUrl": "https://example.com",
  "maxPages": 60
}
```

`resync` clears old RAG pages/chunks for that chatbot, then re-crawls.

### Check ingestion status

- `GET /api/rag/ingest/status?runId=<uuid>`
- Response:

```json
{
  "ok": true,
  "run": {
    "runId": "uuid",
    "chatbotId": "uuid",
    "status": "running|done|failed|canceled",
    "pagesFound": 40,
    "pagesCrawled": 22,
    "chunksWritten": 185,
    "error": null,
    "cancelRequested": false,
    "startedAt": "2026-02-28T10:00:00.000Z",
    "finishedAt": null,
    "updatedAt": "2026-02-28T10:03:00.000Z"
  }
}
```

### Cancel ingestion

- `POST /api/rag/ingest/cancel`
- Body:

```json
{
  "runId": "uuid"
}
```

## Chat integration

- `POST /api/chat` accepts dashboard chatbot id (`chatbotId` or `chatbot_id`) or widget key (`widgetKey` or `key`).
- Runtime flow:
  - Embed last user query.
  - Retrieve top vector matches scoped to `chatbot_id`.
  - Build strict context instruction:
    - answer only from provided context
    - if unknown, say "I don't know" and suggest contacting the business
  - Return answer text only.

## Monitoring and operations

- Only one active ingestion per chatbot is allowed.
- Progress is persisted to `rag_ingestion_runs` and mirrored in-memory.
- `POST /cancel` sets `cancel_requested`; workers stop quickly and finalize as `canceled`.
- Maintenance scheduler:
  - every 5 minutes: marks stale `running` runs as `failed` if `updated_at` is older than 15 minutes.
  - every hour: reserved stub for optional future automated re-syncs.

## Expected durations

Typical ingestion time depends on site size/content:

- 20 pages: usually a few minutes.
- 50-100 pages: typically several minutes to ~20 minutes (embedding throughput and page response times dominate).

Use status polling from dashboard UI during sync.

## Suggested UI flow

1. User clicks `Sync website`.
2. Frontend calls `POST /api/rag/ingest/start`.
3. Frontend polls `GET /api/rag/ingest/status?runId=...` every 2-5 seconds.
4. Show progress (`pagesCrawled / pagesFound`, chunks written, status, errors).
5. On `done`, show "Test chat" CTA to validate responses.
