import { describe, it, expect, vi } from 'vitest'
import { readShopifyConfig, isShopifyConfigured, variantForTemplate } from '../config'
import {
  buildLineItemProperties,
  sanitizeLineItemProperties,
  buildCartAjaxPayload,
  buildStorefrontCartLine,
  addToCart,
  ALLOWED_PROPERTY_KEYS,
  type DesignReference,
} from '../cart'

const design: DesignReference = {
  projectId: 'proj-123',
  templateId: 'haggadah',
  pdfUrl: 'https://storage.example/signed/abc?token=xyz&expires=1',
  pageCount: 52,
  bookTitle: 'My Family Haggadah',
}

/** A fully-configured, live-enabled config for the tests that need one. */
function liveConfig() {
  return readShopifyConfig({
    SHOPIFY_STORE_DOMAIN: 'alefbook.myshopify.com',
    SHOPIFY_STOREFRONT_API_TOKEN: 'tok_test',
    SHOPIFY_LIVE_ENABLED: 'true',
    SHOPIFY_PRODUCT_VARIANTS: JSON.stringify({ haggadah: '111', 'blessings-booklet': '222' }),
  })
}

// ── Config parsing ───────────────────────────────────────────────────────────

describe('readShopifyConfig', () => {
  it('is unconfigured + live-disabled by default (safe: no store, no live calls)', () => {
    const cfg = readShopifyConfig({})
    expect(isShopifyConfigured(cfg)).toBe(false)
    expect(cfg.liveEnabled).toBe(false)
    expect(cfg.productVariants).toEqual({})
  })

  it('parses the templateId→variant map and coerces ids to strings', () => {
    const cfg = readShopifyConfig({
      SHOPIFY_PRODUCT_VARIANTS: JSON.stringify({ haggadah: 111, blank: '222' }),
    })
    expect(variantForTemplate(cfg, 'haggadah')).toBe('111')
    expect(variantForTemplate(cfg, 'blank')).toBe('222')
    expect(variantForTemplate(cfg, 'missing')).toBeUndefined()
  })

  it('tolerates malformed variant JSON without throwing', () => {
    const cfg = readShopifyConfig({ SHOPIFY_PRODUCT_VARIANTS: '{not json' })
    expect(cfg.productVariants).toEqual({})
  })

  it('treats liveEnabled as strictly "true"', () => {
    expect(readShopifyConfig({ SHOPIFY_LIVE_ENABLED: 'true' }).liveEnabled).toBe(true)
    expect(readShopifyConfig({ SHOPIFY_LIVE_ENABLED: '1' }).liveEnabled).toBe(false)
    expect(readShopifyConfig({ SHOPIFY_LIVE_ENABLED: 'TRUE' }).liveEnabled).toBe(true)
  })
})

// ── Privacy gate: line-item properties ──────────────────────────────────────

describe('line-item properties (privacy gate)', () => {
  it('emits only whitelisted, underscore-prefixed reference keys', () => {
    const props = buildLineItemProperties(design)
    expect(Object.keys(props).sort()).toEqual([...ALLOWED_PROPERTY_KEYS].sort())
    expect(props._alefbook_project_id).toBe('proj-123')
    expect(props._alefbook_template_id).toBe('haggadah')
    expect(props._alefbook_pdf_url).toBe(design.pdfUrl)
    expect(props._alefbook_page_count).toBe('52')
    // Every key hidden from the storefront cart UI.
    for (const k of Object.keys(props)) expect(k.startsWith('_')).toBe(true)
  })

  it('carries a reference only — no raw design content leaks into the cart', () => {
    const props = buildLineItemProperties(design)
    const blob = JSON.stringify(props)
    // The PDF is referenced by signed URL, never inlined; no LaTeX/source keys.
    expect(blob).not.toContain('\\documentclass')
    expect(blob).not.toContain('bookTitle') // human title isn't a cart property
  })

  it('sanitize drops any non-whitelisted key (defence in depth)', () => {
    const dirty = {
      _alefbook_project_id: 'p',
      _customer_email: 'leak@example.com',
      note: 'internal',
    }
    const clean = sanitizeLineItemProperties(dirty)
    expect(clean).toEqual({ _alefbook_project_id: 'p' })
    expect(clean._customer_email).toBeUndefined()
  })
})

// ── Payload builders ─────────────────────────────────────────────────────────

describe('cart payload builders', () => {
  it('buildCartAjaxPayload produces a /cart/add.js item with the mapped variant', () => {
    const payload = buildCartAjaxPayload(liveConfig(), design)
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0].id).toBe('111')
    expect(payload.items[0].quantity).toBe(1)
    expect(payload.items[0].properties._alefbook_project_id).toBe('proj-123')
  })

  it('throws a clear error when the template has no configured variant', () => {
    const cfg = readShopifyConfig({})
    expect(() => buildCartAjaxPayload(cfg, design)).toThrowError(/No Shopify variant configured/)
  })

  it('buildStorefrontCartLine yields a gid + attribute list for server-side carts', () => {
    const line = buildStorefrontCartLine(liveConfig(), design)
    expect(line.merchandiseId).toBe('gid://shopify/ProductVariant/111')
    expect(line.quantity).toBe(1)
    const projAttr = line.attributes.find((a) => a.key === '_alefbook_project_id')
    expect(projAttr?.value).toBe('proj-123')
  })
})

// ── addToCart: live-call gate (no live calls in tests) ──────────────────────

describe('addToCart live-call gate', () => {
  it('stays in mock mode (no fetch) when live is disabled', async () => {
    const fetchImpl = vi.fn()
    const cfg = readShopifyConfig({
      SHOPIFY_STORE_DOMAIN: 'alefbook.myshopify.com',
      SHOPIFY_STOREFRONT_API_TOKEN: 'tok',
      SHOPIFY_LIVE_ENABLED: 'false',
      SHOPIFY_PRODUCT_VARIANTS: JSON.stringify({ haggadah: '111' }),
    })

    const result = await addToCart(cfg, design, { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result.live).toBe(false)
    expect(result.status).toBe('mock-live-disabled')
    expect(result.payload.items[0].id).toBe('111')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('stays in mock mode when live is enabled but the store is unconfigured', async () => {
    const fetchImpl = vi.fn()
    const cfg = readShopifyConfig({
      SHOPIFY_LIVE_ENABLED: 'true',
      SHOPIFY_PRODUCT_VARIANTS: JSON.stringify({ haggadah: '111' }),
    })

    const result = await addToCart(cfg, design, { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result.live).toBe(false)
    expect(result.status).toBe('mock-not-configured')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('performs exactly one mocked POST to /cart/add.js when live + configured', async () => {
    const fetchImpl = vi.fn(async () => ({ json: async () => ({ token: 'cart-1', item_count: 1 }) }))
    const result = await addToCart(liveConfig(), design, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://alefbook.myshopify.com/cart/add.js')
    expect(init.method).toBe('POST')
    // The mocked store never sees raw content — only the whitelisted payload.
    const sent = JSON.parse(init.body as string)
    expect(sent.items[0].id).toBe('111')
    expect(Object.keys(sent.items[0].properties).every((k) => k.startsWith('_'))).toBe(true)

    expect(result.live).toBe(true)
    expect(result.status).toBe('live-added')
    expect(result.response).toEqual({ token: 'cart-1', item_count: 1 })
  })
})
