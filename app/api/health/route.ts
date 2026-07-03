// Force dynamic rendering: without this, Next.js statically prerenders this
// route at build time, so the deployed endpoint returns a frozen timestamp
// from whenever the Docker image was built (observed in production: a
// 2026-03-30 timestamp served months later). Railway's healthcheck only needs
// a 200, but a live timestamp is what makes this useful for humans checking
// whether the container is actually serving fresh responses.
export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({ status: 'ok', timestamp: new Date().toISOString() })
}
