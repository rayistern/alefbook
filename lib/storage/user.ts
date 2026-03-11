import { clerkClient } from '@clerk/nextjs/server'
import { createClient } from './supabase'

/**
 * Look up the internal DB user ID for a Clerk user.
 * If the user doesn't exist yet (webhook race condition), auto-provision them.
 */
export async function getOrCreateUserId(clerkId: string): Promise<string | null> {
  const supabase = createClient()

  // Try to find existing user
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_id', clerkId)
    .single()

  if (existing) return existing.id

  // User authenticated via Clerk but not yet in DB (webhook race condition).
  // Auto-provision the record.
  const client = await clerkClient()
  const clerkUser = await client.users.getUser(clerkId)
  const email = clerkUser.emailAddresses?.[0]?.emailAddress
  if (!email) return null

  const { data } = await supabase
    .from('users')
    .upsert({ clerk_id: clerkId, email }, { onConflict: 'clerk_id' })
    .select('id')
    .single()

  return data?.id ?? null
}
