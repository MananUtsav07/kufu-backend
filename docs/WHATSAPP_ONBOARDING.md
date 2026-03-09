# WhatsApp Embedded Onboarding

This document describes the Meta Embedded Signup onboarding flow implemented in Kufu.

## Prerequisites (Meta)

1. Create a Meta app with WhatsApp product enabled.
2. Configure Embedded Signup in Meta and copy the configuration ID.
3. Configure app domains/redirect URI in Meta.
4. Keep the app in development or production mode based on your rollout stage.

## Environment Variables

Backend (`kufu-backend/.env`):

- `META_APP_ID`
- `META_APP_SECRET`
- `META_VERIFY_TOKEN`
- `META_GRAPH_API_VERSION` (fallbacks to `WHATSAPP_GRAPH_API_VERSION`)
- `META_REDIRECT_URI`
- `META_EMBEDDED_SIGNUP_CONFIG_ID`
- `FRONTEND_URL`
- `BACKEND_BASE_URL`

Frontend (`kufu-frontend/.env`):

- `VITE_API_BASE_URL`
- `VITE_META_APP_ID` (optional fallback for SDK init)

## Route Flow

### 1) Start Onboarding

`POST /api/whatsapp/onboarding/start` (auth required)

- Resolves the selected chatbot for current user.
- Returns onboarding bootstrap payload:
  - Meta app id/config id
  - webhook URL
  - verify token
  - redirect URI
  - generated onboarding state

### 2) Complete Onboarding

`POST /api/whatsapp/onboarding/complete` (auth required)

- Accepts data from Embedded Signup popup:
  - OAuth code and/or access token
  - business account id / phone number id (if present)
  - raw onboarding payload
- Exchanges OAuth code for token when needed.
- Persists WhatsApp integration metadata.
- Attempts automatic webhook subscription using Graph API.
- Marks integration `connected` or `failed`.

### 3) Check Status

`GET /api/whatsapp/status` (auth required)

- Returns connected state and integration details for dashboard UI.

### 4) Retry Webhook Subscription

`POST /api/whatsapp/webhooks/subscribe` (auth required)

- Re-runs Graph webhook subscription for saved integration.
- Updates status and webhook subscription flag.

### 5) Callback Redirect

`GET /api/whatsapp/callback`

- Optional callback endpoint.
- Redirects user to frontend connect page with `status` query params.

## Webhook Endpoints

Public endpoints already used by automation:

- `GET /api/whatsapp/webhook`
  - Supports Meta verification challenge.
  - Accepts:
    - per-integration verify token (multi-tenant)
    - global `META_VERIFY_TOKEN` fallback
- `POST /api/whatsapp/webhook`
  - Accepts inbound events.
  - Processes supported text messages and sends AI replies.
  - Writes JSONL event logs.

## Database

Migration: `supabase/migrations/007_whatsapp_embedded_signup.sql`

Enhancements:

- Adds onboarding fields to `whatsapp_integrations`:
  - `whatsapp_business_account_id`
  - `business_phone_number_id`
  - `phone_number`
  - `status`
  - `onboarding_payload`
  - `webhook_subscribed`
- Adds `whatsapp_onboarding_logs` table for audit trail.

## Frontend Redirect Flow

1. User creates integration (chatbot) in dashboard.
2. App redirects to `/dashboard/integrations/whatsapp/connect`.
3. Page initializes onboarding via backend start endpoint.
4. User clicks Connect WhatsApp and completes Meta popup.
5. Page submits completion payload to backend.
6. On success, user is redirected back to `/dashboard/integrations?wa_connected=1`.

## What Happens After Form Submit

The onboarding form now drives a deterministic setup flow:

1. Chatbot is created.
2. User lands on WhatsApp connect page.
3. Embedded signup captures Meta grant/session data.
4. Backend persists integration + subscription status.
5. Dashboard reflects final state (`Not connected`, `Connecting`, `Connected`, `Failed`).
