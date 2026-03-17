import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } })

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // If Supabase isn't configured, allow public routes and block everything else
  if (!supabaseUrl || !supabaseKey) {
    const isPublicRoute = request.nextUrl.pathname === '/' ||
      request.nextUrl.pathname === '/gallery' ||
      request.nextUrl.pathname.startsWith('/view/') ||
      request.nextUrl.pathname === '/api/health' ||
      request.nextUrl.pathname === '/api/admin/compile-templates'
    if (isPublicRoute) return response
    return NextResponse.json({ error: 'Service not configured' }, { status: 503 })
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request: { headers: request.headers } })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as never)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isAuthRoute = request.nextUrl.pathname.startsWith('/auth')
  const isApiRoute = request.nextUrl.pathname.startsWith('/api')
  const isPublicRoute = request.nextUrl.pathname === '/' ||
    request.nextUrl.pathname === '/gallery' ||
    request.nextUrl.pathname.startsWith('/view/') ||
    request.nextUrl.pathname === '/api/health' ||
    request.nextUrl.pathname === '/api/admin/compile-templates'

  if (isPublicRoute || isAuthRoute) {
    return response
  }

  if (!user && isApiRoute) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!user) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)'],
}
