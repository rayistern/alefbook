import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const sort = searchParams.get('sort') ?? 'newest'
  const limit = Math.min(Number(searchParams.get('limit') ?? 20), 50)
  const offset = Number(searchParams.get('offset') ?? 0)

  const supabase = createServiceClient()

  let query = supabase
    .from('projects')
    .select('id, name, description, page_count, fork_count, created_at, user_id, profiles(display_name, avatar_url)')
    .eq('is_public', true)
    .eq('status', 'ready')
    .range(offset, offset + limit - 1)

  if (sort === 'forks') {
    query = query.order('fork_count', { ascending: false })
  } else {
    query = query.order('created_at', { ascending: false })
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
