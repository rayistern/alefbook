import { Webhook } from 'svix'
import { headers } from 'next/headers'
import { createClient } from '@/lib/storage/supabase'

interface ClerkUserEvent {
  data: {
    id: string
    email_addresses: Array<{ email_address: string }>
    first_name?: string
    last_name?: string
  }
  type: string
}

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET
  if (!WEBHOOK_SECRET) {
    return new Response('Webhook secret not configured', { status: 500 })
  }

  const headerPayload = headers()
  const svixId = headerPayload.get('svix-id')
  const svixTimestamp = headerPayload.get('svix-timestamp')
  const svixSignature = headerPayload.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response('Missing svix headers', { status: 400 })
  }

  const payload = await req.json()
  const body = JSON.stringify(payload)

  const wh = new Webhook(WEBHOOK_SECRET)

  let event: ClerkUserEvent
  try {
    event = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkUserEvent
  } catch {
    return new Response('Invalid webhook signature', { status: 400 })
  }

  if (event.type === 'user.created' || event.type === 'user.updated') {
    const supabase = createClient()
    const { data: userData } = event
    const email = userData.email_addresses?.[0]?.email_address

    if (!email) {
      return new Response('No email in event', { status: 400 })
    }

    const { error } = await supabase
      .from('users')
      .upsert(
        {
          clerk_id: userData.id,
          email,
        },
        { onConflict: 'clerk_id' }
      )

    if (error) {
      console.error('Failed to upsert user:', error)
      return new Response('Database error', { status: 500 })
    }
  }

  return new Response('OK', { status: 200 })
}
