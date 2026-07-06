import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getProjectPdfUrl } from '@/lib/latex/compiler'
import { readShopifyConfig } from '@/lib/shopify/config'
import { addToCart, type DesignReference } from '@/lib/shopify/cart'

/**
 * POST /api/cart — hand a finished design back to the Shopify cart (POC).
 *
 * This is the server side of the ALEF1 cart write-back: given a project the
 * user owns, it builds a privacy-gated Shopify line item (variant + reference
 * properties carrying a short-lived signed PDF URL) and returns it. The default
 * response is the built payload in "mock" mode — no live store call is made
 * unless SHOPIFY_LIVE_ENABLED=true AND the store is configured (see
 * lib/shopify/cart.ts addToCart). A same-origin storefront can post the
 * returned payload to /cart/add.js itself; or, when live is enabled, the store
 * is written server-side here.
 *
 * ─── Privacy gate ───────────────────────────────────────────────────────────
 *  1. AUTH: requires a signed-in user.
 *  2. OWNERSHIP: the project must belong to that user — you can only cart YOUR
 *     own design, never another user's project id.
 *  3. REFERENCE-ONLY: only a signed, expiring PDF URL + ids leave this route,
 *     enforced by the whitelist in buildLineItemProperties.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Gate 1: authentication.
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { projectId } = await request.json().catch(() => ({ projectId: undefined }))
  if (!projectId || typeof projectId !== 'string') {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }

  // Gate 2: ownership — the project must belong to the caller.
  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id, name, template_id, page_count')
    .eq('id', projectId)
    .single()

  if (!project || project.user_id !== user.id) {
    // 404 (not 403) so we don't confirm the existence of someone else's project.
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // A short-lived signed URL (1h) to the print-ready PDF — a reference, not the
  // file. Absent ⇒ the book hasn't been compiled yet.
  const pdfUrl = await getProjectPdfUrl(project.id)
  if (!pdfUrl) {
    return NextResponse.json(
      { error: 'No compiled PDF for this project yet.' },
      { status: 409 }
    )
  }

  const design: DesignReference = {
    projectId: project.id,
    templateId: project.template_id ?? 'blank',
    pdfUrl,
    pageCount: project.page_count ?? 0,
    bookTitle: project.name ?? undefined,
  }

  const config = readShopifyConfig()
  try {
    const result = await addToCart(config, design)
    return NextResponse.json({
      status: result.status,
      live: result.live,
      // The payload a same-origin storefront can POST to /cart/add.js.
      payload: result.payload,
      ...(result.response ? { response: result.response } : {}),
    })
  } catch (err) {
    // Most likely: no variant configured for this template.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cart build failed' },
      { status: 422 }
    )
  }
}
