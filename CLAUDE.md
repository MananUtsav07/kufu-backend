# CLAUDE.md — kufu-backend

## Project Overview

**Kufu** is a SaaS chatbot platform. This repo is the **backend** — Express 5 + TypeScript API, deployed on Render.

Primary responsibilities: custom JWT auth, dashboard/admin APIs, AI chat with RAG retrieval, lead capture, WhatsApp webhook handling, email notifications.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js (ESM) |
| Framework | Express 5 |
| Language | TypeScript 5 |
| Database | Supabase Postgres (service role, server-side only) |
| AI | OpenAI SDK (default model: `gpt-4o-mini`) |
| Auth | Custom JWT (`jsonwebtoken`), bcrypt |
| Email | Brevo (Sendinblue) via REST API |
| Validation | Zod |
| Security | Helmet, CORS allowlist, rate limiting (fixed window) |
| RAG | Custom: Playwright/fetch crawler + chunker + OpenAI embeddings + Supabase vector store |
| WhatsApp | Meta Graph API v22.0, Embedded Signup flow |
| Testing | Vitest + Supertest |
| Deployment | Render (see `docs/DEPLOYMENT.md`) |

---

## Environment Variables

See `.env.example` for the full list. Groups:

| Group | Variables |
|---|---|
| Runtime | `NODE_ENV`, `PORT` (8787), `DATA_DIR`, `DEV_BYPASS_EMAIL_VERIFY` |
| CORS/URLs | `FRONTEND_URL`, `BACKEND_BASE_URL`, `ALLOWED_ORIGINS` |
| Database | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Auth | `JWT_SECRET` |
| Email | `BREVO_API_KEY`, `EMAIL_FROM`, `DEMO_LEAD_NOTIFY_EMAIL`, `CONTACT_LEAD_NOTIFY_EMAIL` |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| WhatsApp/Meta | `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_GRAPH_API_VERSION`, `META_REDIRECT_URI`, `META_EMBEDDED_SIGNUP_CONFIG_ID`, `WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_WEBHOOK_ALLOWED_IPS` |
| Rate limits | `RATE_LIMIT_AUTH_PER_MINUTE`, `RATE_LIMIT_CHAT_PER_MINUTE`, `RATE_LIMIT_LEADS_PER_MINUTE`, `RATE_LIMIT_WEBHOOKS_PER_MINUTE` |
| Widget | `DEFAULT_WIDGET_LOGO_PATH`, `DEFAULT_WIDGET_LOGO_URL` |
| RAG | `ENABLE_PLAYWRIGHT`, `RAG_JS_RENDER_TIMEOUT_MS`, `JINA_API_KEY` |

---

## Project Structure

```
src/
  index.ts                        # Express app setup, middleware, mounts all routers, starts server
  config/
    runtime.ts                    # Reads and exports all env vars; initialises OpenAI + Supabase clients

  routes/
    api.ts                        # Root /api router — assembles all sub-routers
    auth.ts                       # /api/auth/* — register, verify-email, verify (GET), login, me, logout
    dashboard.ts                  # /api/dashboard/* — all authenticated dashboard endpoints
    admin.ts                      # /api/admin/* — admin-only endpoints
    chat.ts                       # /api/chat + /api/chat/log — public + widget chat endpoint
    chatbot.ts                    # /api/chatbot/* — chatbot public key lookup
    widget.ts                     # /widget/* — serves widget JS script; /api/widget/* — widget API helpers
    whatsapp.ts                   # /api/whatsapp/* — Meta webhook verify + inbound + onboarding
    rag.ts                        # /api/rag/* — RAG ingestion trigger (authenticated)
    siteDetection.ts              # /api/site-detection/* — website platform detection

  lib/
    auth-middleware.ts            # JWT extraction from cookie or Authorization header
    authSession.ts                # Session helpers
    cache.ts                      # TtlCache in-memory cache
    corsOrigins.ts                # Dynamic CORS origin handler
    dataStore.ts                  # JSONL file store (leads, chats, knowledge.md)
    errorHandler.ts               # Global Express error handler + 404 handler
    errors.ts                     # AppError class, asyncHandler wrapper
    http.ts                       # sendApiError, respondValidationError, getClientIp, hashIp
    jwt.ts                        # signAuthToken, verifyAuthToken
    knowledge.ts                  # Loads knowledge.md from DATA_DIR
    logger.ts                     # Structured JSON logger (logInfo, logError, logWarn)
    mailer.ts                     # Brevo email client — sendVerificationEmail, sendDemoLeadNotification, sendContactLeadNotification
    property-management-auth.ts   # (legacy/feature-specific auth helper)
    rateLimit.ts                  # createFixedWindowLimiter
    requestContext.ts             # Attaches requestId to each request
    sanitizeMessages.ts           # Strips unsafe content from chat messages
    supabase.ts                   # Supabase client factory
    systemPrompt.ts               # Builds the OpenAI system prompt from knowledge + chatbot settings
    tenant-session.ts             # Tenant/session helpers
    validation.ts                 # Shared Zod helpers

  services/
    analyticsService.ts           # computeChatAnalytics (popular questions, peak hours)
    auditService.ts               # writeAuditLog to Supabase
    chatHistoryService.ts         # listChatHistory, searchChatHistory, insertChatHistoryRow, isFirstVisitorSessionMessage, isFirstLeadCaptureForVisitorSession
    chatService.ts                # loadClientKnowledgeText, storeChatMessages, upsertLeadFromMessage, appendLeadCaptureAcknowledgement, estimateTokens
    chatbotSettingsService.ts     # Load/save chatbot UI settings (bot name, greeting, color)
    clientNotificationService.ts  # notifyClientOnLeadCapture, notifyClientOnNewChat (email to client)
    embedSnippetService.ts        # buildWidgetEmbedSnippet — generates the <script> embed code
    storageService.ts             # Supabase Storage ops for KB docs + logos
    subscriptionService.ts        # loadPlanByCode, ensureSubscription, enforcePlanMessageLimit, incrementSubscriptionUsage, getUserPlanContext
    tenantService.ts              # loadUserById, loadUserByEmail, loadClientByUserId, loadChatbotByPublicKey, ensureDefaultChatbot, createWidgetPublicKey, buildAllowedDomains, ensureTenantOwnership
    whatsappService.ts            # upsertWhatsAppIntegration, sendWhatsAppTextMessage, createWhatsAppVerifyToken, loadWhatsAppIntegrationByUserId
    whatsappOnboardingService.ts  # startWhatsAppOnboarding, completeWhatsAppOnboarding
    siteDetection/
      detectWebsiteType.ts        # Classifies website as wordpress/shopify/react/nextjs/webflow/wix/squarespace/custom
      installGuide.ts             # Returns platform-specific embed instructions

  rag/
    chunker.ts                    # Splits crawled text into chunks
    crawler.ts                    # Fetches web pages (fetch or Playwright)
    embeddings.ts                 # OpenAI text-embedding-3-small embeddings
    ingestionManager.ts           # Orchestrates RAG ingestion + maintenance schedulers
    retrieval.ts                  # retrieveRelevantChunks — vector similarity search in Supabase

  schemas/
    auth.ts                       # loginSchema, registerSchema, verifyEmailSchema, authTokenQuerySchema
    api.ts                        # chatSchema, chatLogSchema, demoLeadSchema, contactLeadSchema
    chatbot.ts                    # Chatbot CRUD schemas
    dashboard.ts                  # All dashboard endpoint schemas
    admin.ts                      # Admin endpoint schemas
    siteDetection.ts              # siteDetectionSchema
    whatsapp.ts                   # WhatsApp endpoint schemas

  types/
    auth.ts                       # UserRole type

  data/                           # Runtime data files (not committed, .gitignore'd except seed)
    chats.jsonl                   # Chat log (legacy/public chat)
    chats_ai.jsonl                # AI chat log
    leads_contact.jsonl           # Contact form leads
    leads_demo.jsonl              # Demo request leads
    knowledge.md                  # Global fallback knowledge base

api/
  index.ts                        # Vercel serverless entry point (re-exports app)

supabase/
  migrations/                     # Apply in numeric order against Supabase project
    001_plans_subscriptions.sql
    002_rag.sql
    003_uploads_and_admin_plans.sql
    004_chat_history_analytics_settings.sql
    005_custom_quote_monthly_messages.sql
    006_whatsapp_automation.sql
    007_whatsapp_embedded_signup.sql
    008_performance_indexes.sql
    009_backfill_chatbot_client_id.sql
    010_website_integrations.sql

docs/
  API_ROUTES.md                   # Full request/response examples for all endpoints
  API_RAG.md                      # RAG system documentation
  DEPLOYMENT.md                   # Render deployment steps
  PRE_DEPLOY_CHECKLIST.md         # Pre-launch checklist
  REQUIRED_SCHEMA.md              # Required Supabase tables/columns
  DB_INDEX_AUDIT.md               # Index decisions
  PERFORMANCE.md                  # Performance notes
  ROLLBACK_PLAN.md                # Rollback procedure
  WHATSAPP_ONBOARDING.md          # WhatsApp setup guide
```

---

## API Routes (all under `/api`)

| Route | Auth | Purpose |
|---|---|---|
| `GET /health` | None | Health check |
| `POST /auth/register` | None | Create account + send verification email |
| `POST /auth/verify-email` | None | Verify email via token (JSON body) |
| `GET /auth/verify` | None | Verify email via token (URL param, returns HTML) |
| `POST /auth/login` | None | Login → sets `kufu_session` cookie + returns JWT |
| `GET /auth/me` | JWT | Current user + client + subscription + plan |
| `POST /auth/logout` | None | Clears `kufu_session` cookie |
| `GET /dashboard/summary` | JWT | Stats: messages used, plan, integrations, open tickets |
| `GET /dashboard/chatbots` | JWT | List user's chatbots |
| `POST /dashboard/chatbots` | JWT | Create chatbot |
| `PATCH /dashboard/chatbots/:id` | JWT | Update chatbot |
| `GET /dashboard/knowledge` | JWT | Load knowledge base |
| `PUT /dashboard/knowledge` | JWT | Save knowledge base |
| `GET /dashboard/leads` | JWT | List leads |
| `PATCH /dashboard/leads/:id` | JWT | Update lead status |
| `GET /dashboard/chat-history` | JWT | Chat history (paginated) |
| `GET /dashboard/analytics` | JWT | Analytics data |
| `GET /dashboard/tickets` | JWT | Support tickets |
| `POST /dashboard/tickets` | JWT | Create ticket |
| `PATCH /dashboard/tickets/:id` | JWT (admin) | Update ticket |
| `GET /dashboard/quotes` | JWT | Custom quotes |
| `POST /dashboard/quotes` | JWT | Request custom quote |
| `GET /dashboard/profile` | JWT | User profile |
| `PATCH /dashboard/profile` | JWT | Update profile |
| `GET /dashboard/embed-snippet` | JWT | Get widget embed code |
| `GET /dashboard/chatbot-settings` | JWT | Chatbot UI settings |
| `PATCH /dashboard/chatbot-settings` | JWT | Update chatbot UI settings |
| `GET /dashboard/whatsapp` | JWT | WhatsApp integration info |
| `POST /dashboard/whatsapp/test-message` | JWT | Send test WhatsApp message |
| `DELETE /dashboard/whatsapp` | JWT | Remove WhatsApp integration |
| `POST /api/whatsapp/onboarding/start` | JWT | Start Meta Embedded Signup flow |
| `POST /api/whatsapp/onboarding/complete` | JWT | Complete onboarding with code |
| `GET /api/whatsapp/webhook` | None | Meta webhook verification |
| `POST /api/whatsapp/webhook` | IP allowlist | Inbound WhatsApp messages |
| `POST /chat` | Optional JWT | Main chat endpoint (widget + dashboard test) |
| `POST /chat/log` | None | Log chat session |
| `GET /chatbot/:publicKey` | None | Chatbot config by public key |
| `GET /api/site-detection/detect` | JWT | Detect website platform |
| `POST /api/rag/ingest` | JWT | Trigger RAG ingestion for a URL |
| `GET /widget/script` | None | Serve widget JS |
| `POST /leads/demo` | None | Submit demo request |
| `POST /leads/contact` | None | Submit contact form |
| `GET /admin/overview` | JWT + admin | Global platform stats |
| `GET /admin/users` | JWT + admin | All users |
| `GET /admin/messages` | JWT + admin | All chat messages |
| `GET /admin/tickets` | JWT + admin | All tickets |
| `PATCH /admin/tickets/:id` | JWT + admin | Respond to ticket |
| `GET /admin/quotes` | JWT + admin | All custom quotes |
| `PATCH /admin/quotes/:id` | JWT + admin | Respond to quote |

---

## Auth Flow

1. `POST /auth/register` — bcrypt hashes password, creates `users` row (unverified), creates `clients` row, inserts `email_verification_tokens` row (10-min expiry), sends verification email via Brevo
2. `GET /auth/verify?token=…` — verifies token, marks user `is_verified=true`, creates subscription on `free` plan, deletes token row, returns HTML with auto-redirect to `/login`
3. `POST /auth/login` — verifies password, checks `is_verified`, signs JWT, sets `kufu_session` HttpOnly cookie (7 days), returns JSON with token + user + client + subscription + plan
4. Subsequent requests — `auth-middleware` extracts JWT from cookie or `Authorization: Bearer` header
5. `POST /auth/logout` — clears cookie

---

## Database Schema (Supabase Postgres)

Key tables (full schema in `docs/REQUIRED_SCHEMA.md`):
- `users` — id, email, password_hash, is_verified, role
- `clients` — id, user_id, business_name, website_url
- `plans` — id, code, name, monthly_message_cap, chatbot_limit, price_inr, is_active
- `subscriptions` — id, user_id, plan_code, status, current_period_start/end, message_count_in_period, total_message_count
- `chatbots` — id, user_id, client_id, name, website_url, allowed_domains, widget_public_key, logo_path, is_active
- `knowledge` — id, client_id, services_text, pricing_text, faqs_json, hours_text, contact_text, knowledge_base_text
- `leads` — id, client_id, name, email, phone, need, status, source
- `chat_history` — id, chatbot_id, visitor_id, user_message, bot_response, lead_captured
- `chatbot_settings` — chatbot_id, bot_name, greeting_message, primary_color
- `whatsapp_integrations` — chatbot_id, phone_number_id, status, webhook_subscribed, is_active
- `tickets` — id, user_id, subject, message, admin_response, status
- `quotes` — id, user_id, requested_plan, requested_chatbots, requested_monthly_messages, requested_unlimited_messages, notes, status, admin_response
- `rag_chunks` — vector embeddings chunks per chatbot
- `kb_files` — uploaded KB document files
- `email_verification_tokens` — id, user_id, email, token, expires_at
- `audit_log` — actor_user_id, action, metadata

---

## Plan Tiers

| Code | Chatbot limit | Message cap |
|---|---|---|
| `free` | 1 | Low |
| `starter` | Multiple | Medium |
| `pro` | More | Higher |
| `business` | Custom | Custom |

Plans seeded in `plans` table. Enforced in `subscriptionService.ts`.

---

## RAG System

- Trigger: `POST /api/rag/ingest` with a URL
- Flow: crawler fetches page (fetch or Playwright) → chunker splits text → OpenAI embeds chunks → stored in `rag_chunks` table (Supabase vector extension)
- Retrieval: `retrieveRelevantChunks` does cosine similarity search on each chat turn
- Maintenance schedulers run on server start (`startRagMaintenanceSchedulers`)

---

## WhatsApp Integration

- Uses Meta Graph API v22.0 with Embedded Signup
- Onboarding flow: start → frontend shows Meta Embedded Signup → code returned → complete → webhook subscribed
- Webhook: `GET` for verification (META_VERIFY_TOKEN), `POST` for inbound messages (IP allowlist + rate limit)
- Inbound messages → AI reply → send back via Graph API

---

## Security

- `helmet()` — sets secure HTTP headers
- CORS allowlist — only `ALLOWED_ORIGINS` allowed
- Rate limiting — per namespace fixed window (auth: 10/min, chat: 60/min, leads: 20/min, webhooks: 120/min)
- JWT — RS256 or HS256 via `JWT_SECRET`
- Passwords — bcrypt with cost factor 12
- WhatsApp webhook — IP allowlist (`WHATSAPP_WEBHOOK_ALLOWED_IPS`)
- Request IDs — every request gets a `requestId` for tracing

---

## Scripts

```bash
npm run dev               # tsx watch mode
npm run typecheck         # tsc check
npm run test              # vitest integration tests
npm run test:watch        # vitest watch
npm run build             # compile TypeScript → dist/
npm run start             # node dist/index.js
npm run verify-schema     # online Supabase schema check
npm run verify-schema:offline  # migration file sanity check (CI)
npm run smoke-test        # API smoke test script
```

---

## Migrations

Apply in order against your Supabase project:
```
supabase/migrations/001_plans_subscriptions.sql
supabase/migrations/002_rag.sql
...through...
supabase/migrations/010_website_integrations.sql
```

Use `npm run verify-schema` to confirm all required tables, columns, and buckets exist.

---

## Known Gaps / Pre-Launch TODO

See full pre-launch audit in the main conversation context.
