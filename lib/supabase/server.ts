import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Server-side: use non-NEXT_PUBLIC vars to avoid build-time inlining
// These are set as SUPABASE_URL and SUPABASE_ANON_KEY in Railway
function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
}
function getSupabaseKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
}

export function isSupabaseConfigured() {
  return !!(getSupabaseUrl() && getSupabaseKey())
}

export async function createServerSupabase() {
  const cookieStore = await cookies()

  return createServerClient(
    getSupabaseUrl()!,
    getSupabaseKey()!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as never)
            )
          } catch {
            // setAll can fail in Server Components — safe to ignore
          }
        },
      },
    }
  )
}

export function createServiceClient() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require('@supabase/supabase-js')
  return createClient(
    getSupabaseUrl()!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!
  )
}
