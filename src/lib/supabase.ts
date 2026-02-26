import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type SupabaseClientOptions = {
  url: string
  serviceRoleKey: string
}

export function createSupabaseAdminClient(options: SupabaseClientOptions): SupabaseClient | null {
  const url = options.url.trim()
  const serviceRoleKey = options.serviceRoleKey.trim()

  if (!url || !serviceRoleKey) {
    return null
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
