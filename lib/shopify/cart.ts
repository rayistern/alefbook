/**
 * Shopify cart write-back — the ALEF1 "hand a configured line item back to the
 * native Shopify cart" mechanic, as a proof-of-concept.
 *
 * Flow (from the recon, Answer 1 §2): the designer finishes a book → produces a
 * print-ready PDF → this module builds a Shopify line item whose **line-item
 * properties** carry a *reference* to the design (project id, a short-lived
 * signed PDF URL, template id, page count). Those properties ride the item
 * through cart → checkout → order; an order-created webhook (out of scope here)
 * later reads the PDF URL for print fulfillment. Checkout/payment stay native
 * Shopify — this module never sees them.
 *
 * ─── Privacy gate ───────────────────────────────────────────────────────────
 * Line-item properties are visible in the cart, at checkout, and in order
 * exports — so they are a data-egress surface. Two rules are enforced here:
 *   1. WHITELIST: only the known-safe reference keys are ever emitted
 *      (see ALLOWED_PROPERTY_KEYS). Any caller-supplied extras are dropped, so
 *      a bug upstream can't leak arbitrary user/design data into the cart.
 *   2. NO RAW CONTENT: we carry a *reference* (ids + a signed, expiring URL),
 *      never the LaTeX source, chat history, or customer PII. The PDF URL is
 *      expected to be a signed Supabase URL that expires; ownership is enforced
 *      by the API route before this is ever called.
 * A leading underscore on a Shopify line-item property hides it from the
 * customer-facing cart UI while still riding through to the order — we use it
 * for the internal reference keys.
 */

import {
  type ShopifyConfig,
  isShopifyConfigured,
  variantForTemplate,
} from './config'

/** The design reference handed back to the cart. Ids + a signed URL only. */
export interface DesignReference {
  projectId: string
  templateId: string
  /** A signed, short-lived URL to the print-ready PDF. Never a raw file. */
  pdfUrl: string
  pageCount: number
  /** Optional human-facing book title (shown on the cart line). */
  bookTitle?: string
}

/**
 * The only line-item property keys allowed to reach Shopify. The underscore
 * prefix hides them from the storefront cart UI. This whitelist IS the privacy
 * gate — nothing outside it is ever emitted.
 */
export const ALLOWED_PROPERTY_KEYS = [
  '_alefbook_project_id',
  '_alefbook_template_id',
  '_alefbook_pdf_url',
  '_alefbook_page_count',
] as const

/** Shopify AJAX Cart API `POST /cart/add.js` item shape. */
export interface CartAjaxItem {
  id: string // numeric variant id (as string)
  quantity: number
  properties: Record<string, string>
}

/** Shopify Storefront API `cartLinesAdd` line shape (attributes = cart props). */
export interface StorefrontCartLine {
  merchandiseId: string // gid://shopify/ProductVariant/<id>
  quantity: number
  attributes: { key: string; value: string }[]
}

/**
 * Build the privacy-gated line-item properties from a design reference. Only
 * whitelisted keys are produced; anything else is impossible to emit because
 * the object is constructed key-by-key here (not spread from caller input).
 */
export function buildLineItemProperties(design: DesignReference): Record<string, string> {
  const props: Record<string, string> = {
    _alefbook_project_id: design.projectId,
    _alefbook_template_id: design.templateId,
    _alefbook_pdf_url: design.pdfUrl,
    _alefbook_page_count: String(design.pageCount),
  }
  // Defence in depth: strip anything that somehow isn't whitelisted.
  return sanitizeLineItemProperties(props)
}

/**
 * Enforce the whitelist on a properties bag — drops any non-allowed key. Used
 * both when building our own payload and as a guard on any externally-shaped
 * input, so the cart can never carry an unexpected field.
 */
export function sanitizeLineItemProperties(
  props: Record<string, string>
): Record<string, string> {
  const allowed = new Set<string>(ALLOWED_PROPERTY_KEYS)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(props)) {
    if (allowed.has(k)) out[k] = v
  }
  return out
}

/**
 * Build the AJAX Cart API payload (`POST /cart/add.js`). This is the shape a
 * same-origin storefront (App Proxy page or designer subdomain) posts client-
 * side to add the configured item to the native cart.
 *
 * Throws if the template has no configured variant id — a misconfiguration we
 * want surfaced loudly rather than silently adding a wrong/blank product.
 */
export function buildCartAjaxPayload(
  config: ShopifyConfig,
  design: DesignReference,
  quantity = 1
): { items: CartAjaxItem[] } {
  const variantId = variantForTemplate(config, design.templateId)
  if (!variantId) {
    throw new Error(
      `No Shopify variant configured for template "${design.templateId}". ` +
        `Set SHOPIFY_PRODUCT_VARIANTS (JSON map of templateId → variantId).`
    )
  }
  return {
    items: [{ id: variantId, quantity, properties: buildLineItemProperties(design) }],
  }
}

/** Build the Storefront API `cartLinesAdd` line for a server-side cart write. */
export function buildStorefrontCartLine(
  config: ShopifyConfig,
  design: DesignReference,
  quantity = 1
): StorefrontCartLine {
  const variantId = variantForTemplate(config, design.templateId)
  if (!variantId) {
    throw new Error(
      `No Shopify variant configured for template "${design.templateId}".`
    )
  }
  const props = buildLineItemProperties(design)
  return {
    merchandiseId: `gid://shopify/ProductVariant/${variantId}`,
    quantity,
    attributes: Object.entries(props).map(([key, value]) => ({ key, value })),
  }
}

/** Result of an add-to-cart attempt. */
export interface AddToCartResult {
  /** Whether a live network call was actually performed. */
  live: boolean
  /** The payload that was (or would be) sent. */
  payload: { items: CartAjaxItem[] }
  /** Present only when `live` — the store's raw JSON response. */
  response?: unknown
  /** Human-readable status for the caller/log. */
  status: 'live-added' | 'mock-not-configured' | 'mock-live-disabled'
}

/**
 * Add a designed item to the Shopify cart.
 *
 * LIVE-CALL GATE: a real network request happens ONLY when
 *   (a) config.liveEnabled is true (SHOPIFY_LIVE_ENABLED=true), AND
 *   (b) the store is configured (domain + token present).
 * Otherwise it returns the built payload in "mock" mode WITHOUT any network
 * call — this is the path tests and the documented manual smoke use, and it
 * guarantees no accidental hit on the real store.
 *
 * `fetchImpl` is injectable so tests supply a mock and assert the exact request
 * without a real fetch. In production it defaults to global fetch.
 */
export async function addToCart(
  config: ShopifyConfig,
  design: DesignReference,
  options: { quantity?: number; fetchImpl?: typeof fetch } = {}
): Promise<AddToCartResult> {
  const quantity = options.quantity ?? 1
  const payload = buildCartAjaxPayload(config, design, quantity)

  // Gate 1: live calls explicitly disabled ⇒ never touch the network.
  if (!config.liveEnabled) {
    return { live: false, payload, status: 'mock-live-disabled' }
  }
  // Gate 2: store not fully configured ⇒ can't call safely, stay in mock mode.
  if (!isShopifyConfigured(config)) {
    return { live: false, payload, status: 'mock-not-configured' }
  }

  const doFetch = options.fetchImpl ?? fetch
  const url = `https://${config.storeDomain}/cart/add.js`
  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const response = await res.json().catch(() => null)
  return { live: true, payload, response, status: 'live-added' }
}
