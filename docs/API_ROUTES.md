# API Routes

Base URL (dev): `http://localhost:8787`

## Health

### `GET /api/health`
- Auth: none
- Response:
```json
{
  "ok": true,
  "env": "development",
  "openaiKeyPresent": true
}
```

## Auth

### `POST /api/auth/register`
- Auth: none
- Body:
```json
{
  "email": "owner@example.com",
  "password": "StrongPass@123",
  "business_name": "Acme Clinic",
  "website_url": "https://acme.example"
}
```
- Response:
```json
{ "ok": true, "devToken": "...optional in dev..." }
```

### `POST /api/auth/verify-email`
- Auth: none
- Body:
```json
{ "token": "verification-token" }
```
- Response:
```json
{ "ok": true }
```

### `GET /api/auth/verify?token=...`
- Auth: none
- Response: HTML verification page (success/error)

### `POST /api/auth/login`
- Auth: none
- Body:
```json
{ "email": "owner@example.com", "password": "StrongPass@123" }
```
- Response:
```json
{
  "ok": true,
  "token": "jwt",
  "user": { "id": "...", "email": "owner@example.com", "is_verified": true, "role": "user" },
  "client": { "id": "...", "business_name": "Acme Clinic", "website_url": "https://acme.example", "plan": "free" },
  "subscription": { "id": "...", "plan_code": "free", "message_count_in_period": 0, "total_message_count": 0 },
  "plan": { "code": "free", "monthly_message_cap": 10, "chatbot_limit": 1 }
}
```

### `GET /api/auth/me`
- Auth: Bearer JWT or cookie
- Response: same shape for `user`, `client`, `subscription`, `plan`

### `POST /api/auth/logout`
- Auth: optional
- Response:
```json
{ "ok": true }
```

## Chat

### `POST /api/chat`
- Auth mode A: Bearer JWT (dashboard)
- Auth mode B: widget key (`key` in query/body/metadata)
- Body:
```json
{
  "chatbot_id": "uuid-optional-for-dashboard",
  "key": "widget-public-key-optional",
  "sessionId": "session-123",
  "messages": [
    { "role": "user", "content": "What are your pricing plans?" }
  ],
  "metadata": { "page": "/widget" }
}
```
- Response:
```json
{
  "ok": true,
  "reply": "...assistant text...",
  "mode": "dashboard",
  "subscription": { "plan_code": "starter", "message_count_in_period": 15, "total_message_count": 120 },
  "plan": { "code": "starter", "monthly_message_cap": 1000, "chatbot_limit": 1 }
}
```

### `POST /api/chat/log`
- Auth: none
- Body:
```json
{
  "sessionId": "session-123",
  "page": "/demo",
  "messages": [
    { "role": "user", "content": "hello", "createdAt": 1700000000000 }
  ]
}
```
- Response:
```json
{ "ok": true }
```

## Lead Capture

### `POST /api/leads/demo`
- Auth: none
- Body:
```json
{
  "fullName": "Jane Doe",
  "businessType": "clinic",
  "phone": "+91 9999999999",
  "email": "jane@example.com",
  "message": "Need a demo"
}
```
- Response: `{ "ok": true }`

### `POST /api/leads/contact`
- Auth: none
- Body:
```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "jane@example.com",
  "message": "Need pricing"
}
```
- Response: `{ "ok": true }`

## Widget

### `GET /api/widget/config?key=PUBLIC_KEY`
- Auth: none
- Response:
```json
{
  "ok": true,
  "config": {
    "chatbot_id": "...",
    "client_id": "...",
    "widget_public_key": "...",
    "name": "Primary Bot",
    "business_name": "Acme Clinic",
    "theme": "dark",
    "greeting": "Hi, welcome...",
    "logo_url": "https://...signed-url...",
    "allowed_domains": ["acme.example"]
  }
}
```

### `GET /widget/kufu.js?key=PUBLIC_KEY`
- Auth: none
- Response: JavaScript embed loader

## Dashboard (User)

Auth: Bearer JWT (user/admin)

### `GET /api/dashboard/summary`
- Response:
```json
{
  "ok": true,
  "summary": {
    "messages_used_this_period": 12,
    "total_messages_lifetime": 57,
    "plan": "starter",
    "integrations_used": 1,
    "integration_limit": 1,
    "tickets_open": 2
  },
  "recent_sessions": [
    { "session_id": "session-1", "messages": [] }
  ],
  "user": { "id": "...", "email": "...", "role": "user" },
  "client": { "id": "..." },
  "plan": { "code": "starter" },
  "subscription": { "plan_code": "starter" }
}
```

### `GET /api/dashboard/metrics`
- Compatibility metrics endpoint.

### `GET /api/dashboard/plan`
- Returns current `plan` + `subscription`.

### `POST /api/dashboard/profile`
- Body:
```json
{ "business_name": "Acme Clinic", "website_url": "https://acme.example" }
```

### `GET /api/dashboard/chatbots`
- Returns user chatbots.

### `POST /api/dashboard/chatbots`
- Body:
```json
{
  "name": "Website Bot",
  "website_url": "https://acme.example",
  "allowed_domains": ["acme.example"],
  "is_active": true
}
```

### `PATCH /api/dashboard/chatbots/:id`
- Body supports: `name`, `website_url`, `allowed_domains`, `is_active`

### `DELETE /api/dashboard/chatbots/:id`

### `GET /api/dashboard/chatbots/:id/logo`
- Returns signed logo URL for private storage object.
- Response:
```json
{ "ok": true, "logoUrl": "https://...signed-url..." }
```

### `POST /api/dashboard/chatbots/:id/logo`
- Auth: user owns chatbot or admin
- Plan gate: `starter/pro/business` (admin bypass)
- Content-Type: `multipart/form-data`, field `file`
- Allowed: `image/png`, `image/jpeg`, `image/webp`, `image/svg+xml` (max 2MB)
- Response:
```json
{ "ok": true, "logoUrl": "https://...signed-url..." }
```

### `DELETE /api/dashboard/chatbots/:id/logo`
- Auth: user owns chatbot or admin
- Plan gate: `starter/pro/business` (admin bypass)
- Response:
```json
{ "ok": true }
```

### `GET /api/dashboard/chatbots/:id/kb-files`
- Lists KB files for a chatbot.
- Response:
```json
{
  "ok": true,
  "files": [
    {
      "id": "uuid",
      "chatbot_id": "uuid",
      "user_id": "uuid",
      "filename": "faq.pdf",
      "mime_type": "application/pdf",
      "storage_path": "kb/user/chatbot/123_faq.pdf",
      "file_size": 120033,
      "created_at": "2026-03-01T00:00:00.000Z"
    }
  ]
}
```

### `POST /api/dashboard/chatbots/:id/kb-files`
- Auth: user owns chatbot or admin
- Plan gate: `starter/pro/business` (admin bypass)
- Content-Type: `multipart/form-data`, field `file`
- Allowed: `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (max 10MB)
- Response:
```json
{
  "ok": true,
  "file": {
    "id": "uuid",
    "filename": "pricing.docx",
    "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "file_size": 88912,
    "created_at": "2026-03-01T00:00:00.000Z"
  }
}
```

### `DELETE /api/dashboard/kb-files/:fileId`
- Auth: file owner or admin
- Response:
```json
{ "ok": true }
```

### `GET /api/dashboard/embed/:chatbotId`
- Response:
```json
{
  "ok": true,
  "chatbot": { "id": "...", "name": "Website Bot", "widget_public_key": "..." },
  "snippet": "<script src=\"https://.../widget/kufu.js?key=...\" async></script>"
}
```

### `GET /api/dashboard/chat-history/:chatbotId`
- Plan gate: `starter/pro/business` (admin bypass)
- Query params:
  - `from` (ISO datetime, optional)
  - `to` (ISO datetime, optional)
  - `leadCaptured` (`yes|no`, optional)
  - `limit` (default `50`, max `200`)
  - `offset` (default `0`)
- Response:
```json
{
  "ok": true,
  "rows": [
    {
      "id": "uuid",
      "chatbot_id": "uuid",
      "visitor_id": "widget-session-id",
      "user_message": "What are your pricing plans?",
      "bot_response": "We offer Starter, Pro, and Business tiers...",
      "lead_captured": true,
      "created_at": "2026-03-02T12:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 1
  }
}
```
- If blocked by plan:
```json
{ "ok": false, "error": "Access Denied" }
```

### `GET /api/dashboard/chat-history/search`
- Plan gate: `starter/pro/business` (admin bypass)
- Query params:
  - `chatbotId` (required)
  - `q` (required)
  - `from`, `to`, `leadCaptured`, `limit`, `offset` (optional)
- Response shape is the same as `GET /api/dashboard/chat-history/:chatbotId`.

### `GET /api/dashboard/analytics/:chatbotId`
- Plan gate: `pro/business` (admin bypass)
- Query params:
  - `from` (ISO datetime, optional)
  - `to` (ISO datetime, optional)
- Response:
```json
{
  "ok": true,
  "totalChats": 24,
  "popularQuestions": [
    { "question": "What are your plans?", "count": 8 },
    { "question": "Can you integrate WhatsApp?", "count": 5 }
  ],
  "peakHours": [
    { "hour": 10, "count": 3 },
    { "hour": 15, "count": 6 }
  ]
}
```
- If blocked by plan:
```json
{ "ok": false, "error": "Access Denied" }
```

### `POST /api/dashboard/test-chat/:chatbotId`
- Uses tenant knowledge + retrieval for quick in-dashboard testing.
- Does **not** increment subscription usage.
- Body:
```json
{
  "sessionId": "dashboard-test-1",
  "messages": [
    { "role": "user", "content": "How does your setup work?" }
  ]
}
```
- Response:
```json
{
  "ok": true,
  "reply": "We start with a 7-day pilot and configure your channels...",
  "chatbotId": "uuid"
}
```

### `GET /api/chatbot/settings/:chatbotId`
- Auth: user owns chatbot or admin
- Response:
```json
{
  "ok": true,
  "settings": {
    "chatbot_id": "uuid",
    "bot_name": "Website Assistant",
    "greeting_message": "Hi, welcome. How can we help today?",
    "primary_color": "#6366f1"
  }
}
```

### `GET /api/chatbot/user/:userId`
- Auth: Bearer JWT
- Access:
  - `user` can only query their own `userId`
  - `admin` can query any user
- Response:
```json
{
  "ok": true,
  "userId": "uuid",
  "hasChatbot": true,
  "chatbotCount": 2,
  "chatbots": [
    { "id": "uuid", "name": "Website Bot", "is_active": true }
  ]
}
```

### `PUT /api/chatbot/settings/:chatbotId`
- Auth: user owns chatbot or admin
- Body:
```json
{
  "bot_name": "Kufu Assistant",
  "greeting_message": "Hi there, how can I help?",
  "primary_color": "#4f46e5"
}
```
- Response:
```json
{
  "ok": true,
  "settings": {
    "chatbot_id": "uuid",
    "bot_name": "Kufu Assistant",
    "greeting_message": "Hi there, how can I help?",
    "primary_color": "#4f46e5"
  }
}
```

### `GET /api/dashboard/knowledge`

### `POST /api/dashboard/knowledge`
- Body:
```json
{
  "services_text": "...",
  "pricing_text": "...",
  "faqs_json": [{ "q": "...", "a": "..." }],
  "hours_text": "...",
  "contact_text": "...",
  "knowledge_base_text": "..."
}
```

### `GET /api/dashboard/tickets`

### `POST /api/dashboard/tickets`
- Body:
```json
{ "subject": "Need help", "message": "Please help with setup." }
```

### `PATCH /api/dashboard/tickets/:id`
- User can close own ticket only.
- Body:
```json
{ "status": "closed" }
```

### `GET /api/dashboard/quotes`

### `POST /api/dashboard/quotes`
- Body:
```json
{
  "requested_plan": null,
  "requested_chatbots": 3,
  "requested_monthly_messages": 5000,
  "requested_unlimited_messages": false,
  "notes": "Need WhatsApp + Instagram automation with larger monthly volume."
}
```

### `GET /api/dashboard/leads?limit=&offset=&status=`

### `PATCH /api/dashboard/leads/:id`
- Body: `{ "status": "contacted" }`

## Admin

Auth: Bearer JWT (admin role only)

### `GET /api/admin/overview`

### `GET /api/admin/users`
- Returns all users with current plan and period usage.
- Response:
```json
{
  "ok": true,
  "users": [
    {
      "id": "uuid",
      "email": "owner@example.com",
      "role": "user",
      "is_verified": true,
      "created_at": "2026-03-01T00:00:00.000Z",
      "currentPlanCode": "starter",
      "messageUsageThisPeriod": 42
    }
  ]
}
```

### `POST /api/admin/users/:userId/plan`
- Body:
```json
{ "planCode": "pro" }
```
- Effect: sets active subscription plan and resets current period usage window.
- Response:
```json
{ "ok": true, "subscription": { "id": "uuid", "plan_code": "pro" } }
```

### `GET /api/admin/messages?limit=&offset=&user_id=&chatbot_id=&from=&to=`

### `GET /api/admin/messages/export?limit=&offset=&user_id=&chatbot_id=&from=&to=`
- CSV download

### `GET /api/admin/tickets`

### `PATCH /api/admin/tickets/:id`
- Body:
```json
{ "status": "closed", "admin_response": "Issue resolved" }
```

### `GET /api/admin/quotes`

### `PATCH /api/admin/quotes/:id`
- Body:
```json
{ "status": "approved", "admin_response": "Approved", "approve_plan": "pro" }
```

### `POST /api/admin/subscriptions/:userId/set-plan`
- Body:
```json
{ "plan_code": "starter" }
```

### `POST /api/admin/maintenance/reset-periods`

### `GET /api/admin/impersonate/:userId`
- Read-only user/client lookup for admin tooling.

## Error Shape

Non-2xx responses follow:
```json
{
  "ok": false,
  "error": "Human readable message",
  "details": null,
  "requestId": "uuid"
}
```
