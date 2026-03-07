# Property Management API

Base URL (dev): `http://localhost:8787`

## Auth Modes

- Owner routes: `Authorization: Bearer <kufu-user-jwt>`
- Tenant routes: `Authorization: Bearer <tenant-session-jwt>`
- System route: admin kufu JWT required

## Owner Routes

### `POST /api/property-management/owner/tenants`
- Create tenant and generate `tenant_access_id`.
- Body:
```json
{
  "property_name": "Sunrise Apartments",
  "address": "MG Road, Bengaluru",
  "unit_number": "A-203",
  "full_name": "Rahul Verma",
  "email": "rahul@example.com",
  "phone": "+919812345678",
  "password": "TempPass@123",
  "lease_start_date": "2026-03-01",
  "lease_end_date": "2027-02-28",
  "monthly_rent": 25000,
  "payment_due_day": 5
}
```

### `GET /api/property-management/owner/tenants`
- List all owner tenants with property metadata.

### `GET /api/property-management/owner/tenants/:tenantId`
- Tenant detail, plus tickets, reminders, and chat timeline.

### `GET /api/property-management/owner/tickets`
- List all tickets for owner.

### `PATCH /api/property-management/owner/tickets/:ticketId`
- Body:
```json
{ "status": "resolved" }
```

### `GET /api/property-management/owner/notifications`
- Lists owner notifications with `is_read`.

### `GET /api/property-management/owner/dashboard-summary`
- Response:
```json
{
  "ok": true,
  "summary": {
    "activeTenants": 12,
    "openTickets": 3,
    "overdueRent": 2,
    "escalatedChats": 1,
    "remindersPending": 8
  }
}
```

## Tenant Auth

### `POST /api/property-management/tenant/login`
- Login via `tenant_access_id + password` or `tenant_access_id + email + password`.
- Body:
```json
{
  "tenant_access_id": "TEN-AB12CD34",
  "email": "rahul@example.com",
  "password": "TempPass@123"
}
```

### `GET /api/property-management/tenant/me`
- Returns tenant, property, owner support context.

## Tenant Dashboard

### `GET /api/property-management/tenant/dashboard-summary`
- Returns summary counts and rent/payment snapshot.

### `POST /api/property-management/tenant/tickets`
- Body:
```json
{
  "subject": "AC not cooling",
  "message": "The AC stopped cooling since last night."
}
```
- Side effects:
  - owner notification created
  - owner support email sent (if mailer configured)

### `GET /api/property-management/tenant/tickets`
- Lists ticket history for tenant.

### `GET /api/property-management/tenant/messages`
- Returns tenant chat timeline.

### `POST /api/property-management/tenant/chat`
- Body:
```json
{
  "message": "I need a human to help with urgent water leakage"
}
```
- Behavior:
  - intent classified (`maintenance|payment|renewal|general|escalate`)
  - all messages stored in `tenant_chat_messages`
  - escalation creates owner notification + owner email

### `GET /api/property-management/tenant/owner-contact`
- Returns support email + support WhatsApp (display only).

## Reminder Processing

### `POST /api/property-management/system/process-reminders`
- Admin only.
- Body (optional):
```json
{ "referenceDate": "2026-03-07T00:00:00.000Z" }
```
- Marks due `rent_reminders` rows as sent (cron-ready structure).
