import path from 'node:path'
import { access } from 'node:fs/promises'

import dotenv from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

type TableSpec = {
  table: string
  columns: string[]
}

type VerificationFailure = {
  scope: 'env' | 'table' | 'bucket'
  name: string
  details: string
}

const requiredTableSpecs: TableSpec[] = [
  { table: 'users', columns: ['id', 'email', 'password_hash', 'is_verified', 'role', 'created_at'] },
  { table: 'clients', columns: ['id', 'user_id', 'business_name', 'website_url', 'plan', 'knowledge_base_text'] },
  {
    table: 'email_verification_tokens',
    columns: ['id', 'user_id', 'email', 'token', 'expires_at', 'created_at'],
  },
  { table: 'plans', columns: ['id', 'code', 'name', 'monthly_message_cap', 'chatbot_limit', 'price_inr', 'is_active'] },
  {
    table: 'subscriptions',
    columns: [
      'id',
      'user_id',
      'plan_code',
      'status',
      'current_period_start',
      'current_period_end',
      'message_count_in_period',
      'total_message_count',
      'updated_at',
    ],
  },
  {
    table: 'chatbots',
    columns: [
      'id',
      'user_id',
      'client_id',
      'name',
      'website_url',
      'allowed_domains',
      'widget_public_key',
      'logo_path',
      'is_active',
      'created_at',
      'updated_at',
    ],
  },
  {
    table: 'chatbot_messages',
    columns: ['id', 'user_id', 'chatbot_id', 'session_id', 'role', 'content', 'tokens_estimate', 'created_at'],
  },
  {
    table: 'leads',
    columns: ['id', 'client_id', 'name', 'email', 'phone', 'need', 'status', 'source', 'created_at'],
  },
  {
    table: 'client_knowledge',
    columns: ['id', 'client_id', 'services_text', 'pricing_text', 'faqs_json', 'hours_text', 'contact_text', 'updated_at'],
  },
  { table: 'tickets', columns: ['id', 'user_id', 'subject', 'message', 'admin_response', 'status', 'created_at', 'updated_at'] },
  {
    table: 'custom_quotes',
    columns: [
      'id',
      'user_id',
      'requested_plan',
      'requested_chatbots',
      'requested_monthly_messages',
      'requested_unlimited_messages',
      'notes',
      'status',
      'admin_response',
      'created_at',
      'updated_at',
    ],
  },
  { table: 'audit_logs', columns: ['id', 'actor_user_id', 'action', 'metadata', 'created_at'] },
  { table: 'kb_files', columns: ['id', 'chatbot_id', 'user_id', 'filename', 'mime_type', 'storage_path', 'file_size', 'created_at'] },
  { table: 'chat_messages', columns: ['id', 'chatbot_id', 'visitor_id', 'user_message', 'bot_response', 'lead_captured', 'created_at'] },
  {
    table: 'chatbot_settings',
    columns: ['id', 'chatbot_id', 'bot_name', 'greeting_message', 'primary_color', 'updated_at'],
  },
  {
    table: 'whatsapp_integrations',
    columns: [
      'id',
      'user_id',
      'client_id',
      'chatbot_id',
      'phone_number_id',
      'access_token',
      'verify_token',
      'is_active',
      'status',
      'webhook_subscribed',
      'updated_at',
    ],
  },
  {
    table: 'whatsapp_onboarding_logs',
    columns: ['id', 'integration_id', 'user_id', 'client_id', 'chatbot_id', 'event_type', 'payload', 'created_at'],
  },
  {
    table: 'rag_pages',
    columns: ['id', 'chatbot_id', 'url', 'title', 'content_text', 'content_hash', 'status', 'http_status', 'updated_at'],
  },
  {
    table: 'rag_chunks',
    columns: ['id', 'chatbot_id', 'page_id', 'chunk_index', 'chunk_text', 'embedding', 'token_estimate', 'created_at'],
  },
  {
    table: 'rag_ingestion_runs',
    columns: [
      'id',
      'chatbot_id',
      'status',
      'pages_found',
      'pages_crawled',
      'chunks_written',
      'cancel_requested',
      'started_at',
      'finished_at',
      'updated_at',
    ],
  },
  {
    table: 'website_integrations',
    columns: [
      'id',
      'user_id',
      'chatbot_id',
      'website_url',
      'detected_type',
      'detection_confidence',
      'detection_signals',
      'last_detected_at',
      'created_at',
      'updated_at',
    ],
  },
]

const requiredStorageBuckets = ['kufu-logos', 'kufu-kb-docs']
const requiredMigrationFiles = [
  '001_plans_subscriptions.sql',
  '002_rag.sql',
  '003_uploads_and_admin_plans.sql',
  '004_chat_history_analytics_settings.sql',
  '005_custom_quote_monthly_messages.sql',
  '006_whatsapp_automation.sql',
  '007_whatsapp_embedded_signup.sql',
  '008_performance_indexes.sql',
  '009_backfill_chatbot_client_id.sql',
  '010_website_integrations.sql',
]

function readRequiredEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

async function verifyTableColumns(
  client: SupabaseClient,
  tableSpec: TableSpec,
): Promise<VerificationFailure | null> {
  const projection = tableSpec.columns.join(', ')
  const { error } = await client.from(tableSpec.table).select(projection).limit(1)

  if (!error) {
    return null
  }

  return {
    scope: 'table',
    name: tableSpec.table,
    details: `${error.message}${error.details ? ` | ${error.details}` : ''}`,
  }
}

async function verifyStorageBuckets(client: SupabaseClient): Promise<VerificationFailure[]> {
  const { data, error } = await client.storage.listBuckets()

  if (error) {
    return [
      {
        scope: 'bucket',
        name: 'storage.buckets',
        details: `${error.message}${error.details ? ` | ${error.details}` : ''}`,
      },
    ]
  }

  const existingBucketNames = new Set((data ?? []).map((bucket) => bucket.name))
  return requiredStorageBuckets
    .filter((bucketName) => !existingBucketNames.has(bucketName))
    .map((bucketName) => ({
      scope: 'bucket' as const,
      name: bucketName,
      details: 'Bucket is missing.',
    }))
}

async function verifyCanonicalMigrationPath(): Promise<VerificationFailure[]> {
  const failures: VerificationFailure[] = []
  const migrationDirectory = path.resolve(process.cwd(), 'supabase', 'migrations')

  for (const migrationFile of requiredMigrationFiles) {
    const migrationPath = path.join(migrationDirectory, migrationFile)
    try {
      await access(migrationPath)
    } catch {
      failures.push({
        scope: 'table',
        name: migrationFile,
        details: `Missing migration file in canonical path: ${migrationPath}`,
      })
    }
  }

  return failures
}

async function run(): Promise<number> {
  const failures: VerificationFailure[] = []

  const supabaseUrl = readRequiredEnv('SUPABASE_URL')
  const supabaseServiceRoleKey = readRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  const requestedMode = process.env.VERIFY_SCHEMA_MODE?.trim().toLowerCase() || ''
  const cliWantsOffline = process.argv.includes('--offline')
  const mode = cliWantsOffline
    ? 'offline'
    : requestedMode === 'online' || requestedMode === 'offline'
      ? requestedMode
      : supabaseUrl && supabaseServiceRoleKey
        ? 'online'
        : 'offline'

  const migrationFailures = await verifyCanonicalMigrationPath()
  failures.push(...migrationFailures)

  if (mode === 'offline') {
    if (failures.length > 0) {
      console.error('[verify-schema] Offline verification failed.')
      for (const failure of failures) {
        console.error(`- [${failure.scope}] ${failure.name}: ${failure.details}`)
      }
      return 1
    }

    console.log(
      `[verify-schema] Offline mode OK. Verified canonical migration files (${requiredMigrationFiles.length}).`,
    )
    return 0
  }

  if (!supabaseUrl) {
    failures.push({
      scope: 'env',
      name: 'SUPABASE_URL',
      details: 'Missing required environment variable.',
    })
  }

  if (!supabaseServiceRoleKey) {
    failures.push({
      scope: 'env',
      name: 'SUPABASE_SERVICE_ROLE_KEY',
      details: 'Missing required environment variable.',
    })
  }

  if (failures.length > 0 || !supabaseUrl || !supabaseServiceRoleKey) {
    console.error('[verify-schema] Missing required online verification configuration.')
    for (const failure of failures) {
      console.error(`- [${failure.scope}] ${failure.name}: ${failure.details}`)
    }
    return 1
  }

  const client = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  for (const tableSpec of requiredTableSpecs) {
    const failure = await verifyTableColumns(client, tableSpec)
    if (failure) {
      failures.push(failure)
    }
  }

  const bucketFailures = await verifyStorageBuckets(client)
  failures.push(...bucketFailures)

  if (failures.length > 0) {
    console.error('[verify-schema] Schema verification failed.')
    for (const failure of failures) {
      console.error(`- [${failure.scope}] ${failure.name}: ${failure.details}`)
    }
    return 1
  }

  console.log(`[verify-schema] OK. Verified ${requiredTableSpecs.length} tables and ${requiredStorageBuckets.length} storage buckets.`)
  return 0
}

void run()
  .then((exitCode) => {
    process.exit(exitCode)
  })
  .catch((error: unknown) => {
    console.error('[verify-schema] Unexpected failure:', error)
    process.exit(1)
  })
