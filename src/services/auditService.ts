import type { SupabaseClient } from '@supabase/supabase-js'

export async function writeAuditLog(args: {
  supabaseAdminClient: SupabaseClient
  actorUserId: string | null
  action: string
  metadata?: Record<string, unknown>
}) {
  await args.supabaseAdminClient.from('audit_logs').insert({
    actor_user_id: args.actorUserId,
    action: args.action,
    metadata: args.metadata ?? {},
  })
}
