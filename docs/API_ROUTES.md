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

### `GET /api/dashboard/embed/:chatbotId`
- Response:
```json
{
  "ok": true,
  "chatbot": { "id": "...", "name": "Website Bot", "widget_public_key": "..." },
  "snippet": "<script src=\"https://.../widget/kufu.js?key=...\" async></script>"
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
  "requested_plan": "pro",
  "requested_chatbots": 3,
  "requested_unlimited_messages": false,
  "notes": "Need upgrade this month"
}
```

### `GET /api/dashboard/leads?limit=&offset=&status=`

### `PATCH /api/dashboard/leads/:id`
- Body: `{ "status": "contacted" }`

## Admin

Auth: Bearer JWT (admin role only)

### `GET /api/admin/overview`

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
