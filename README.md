# Kufu Backend

Express + TypeScript API for leads and chat.

## Scripts

- `npm install`
- `npm run dev` (http://localhost:8787)
- `npm run build`
- `npm run start`

## Environment (`.env`)

- `OPENAI_API_KEY=`
- `OPENAI_MODEL=gpt-4o-mini` (optional)
- `SUPABASE_URL=`
- `SUPABASE_SERVICE_ROLE_KEY=`
- `JWT_SECRET=`
- `EMAIL_USER=`
- `EMAIL_PASS=`
- `APP_URL=http://localhost:5173` (optional)
- `PORT=8787`
- `CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173`
- `DATA_DIR=data` (optional)

## Vercel (Backend Project)

- Root Directory: `kufu-backend`
- Uses `vercel.json` and `api/index.ts` as serverless entrypoint.

### Routes

- `GET /api/health`
- `POST /api/auth/register`
- `GET /api/auth/verify`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/chat`
- `POST /api/chat/log`
- `POST /api/leads/demo`
- `POST /api/leads/contact`

## Data

Knowledge source:

- `data/kufu_knowledge.md`

Append-only logs:

- `data/leads_demo.jsonl`
- `data/leads_contact.jsonl`
- `data/chats.jsonl`
- `data/chats_ai.jsonl`
