/**
 * Shopify commerce configuration — proof-of-concept for the ALEF1 reframe.
 *
 * Per the ALEF1 recon (batches/audits/alefbook-shopify-mechaber-recon-2026-07-06.md,
 * "Answer 1"), the alefbook designer integrates with the alefbook.org Shopify
 * store as an *external designer app*: it produces a print-ready PDF, then hands
 * a configured line item back to the native Shopify cart. Checkout, payment,
 * and fulfillment stay 100% native Shopify — this module never touches the money
 * path. It only carries a reference to the designed artifact.
 *
 * Everything here is CONFIG-DRIVEN via environment variables — no store domain,
 * product handle, or variant id is hardcoded. A deployment points these at its
 * own store. When unset, the config is in "unconfigured" mode: the cart route
 * still builds and returns the line-item payload (useful for the mock/manual
 * smoke path) but the live-add path is disabled.
 *
 * ─── Where real credentials go ──────────────────────────────────────────────
 * This repo's env pattern is a flat set of vars in `.env.example` consumed via
 * `process.env` (see Supabase / OpenRouter / Upstash). Shopify vars follow the
 * same pattern and are added to `.env.example`:
 *   SHOPIFY_STORE_DOMAIN            e.g. alefbook.myshopify.com (or alefbook.org)
 *   SHOPIFY_STOREFRONT_API_TOKEN    Storefront API public token (server→Storefront cart)
 *   SHOPIFY_LIVE_ENABLED            "true" to permit real network calls (default off)
 *   SHOPIFY_PRODUCT_VARIANTS        JSON map { "<templateId>": "<numericVariantId>" }
 * On Railway these are set as service variables (same as the existing vars).
 * NO live-store credentials are assumed to exist in this POC; tests mock the
 * network entirely and CI never calls the store.
 */

/** One template's Shopify product mapping. */
export interface ShopifyProductMapping {
  /** The alefbook template id (e.g. "haggadah"). */
  templateId: string
  /** The Shopify product variant id this template sells as. */
  variantId: string
}

export interface ShopifyConfig {
  /** Store domain, e.g. "alefbook.myshopify.com". Empty ⇒ unconfigured. */
  storeDomain: string
  /** Storefront API token for server-side cart operations. Empty ⇒ unconfigured. */
  storefrontToken: string
  /**
   * Whether real network calls to the store are permitted. Defaults to FALSE so
   * that an accidental prod deploy, a test, or CI can never hit the live store.
   * This is the outer "no live calls" gate.
   */
  liveEnabled: boolean
  /** templateId → variantId, parsed from SHOPIFY_PRODUCT_VARIANTS JSON. */
  productVariants: Record<string, string>
}

/** A minimal env bag — `process.env` satisfies this, and tests can pass a plain
 * object without needing the full `NodeJS.ProcessEnv` shape (NODE_ENV etc.). */
export type EnvBag = Record<string, string | undefined>

/**
 * Read the Shopify config from the environment. Pure w.r.t. an injected `env`
 * bag so tests can drive it deterministically without touching process.env.
 */
export function readShopifyConfig(env: EnvBag = process.env): ShopifyConfig {
  let productVariants: Record<string, string> = {}
  if (env.SHOPIFY_PRODUCT_VARIANTS) {
    try {
      const parsed = JSON.parse(env.SHOPIFY_PRODUCT_VARIANTS)
      if (parsed && typeof parsed === 'object') {
        // Coerce values to strings; Shopify variant ids are numeric-but-stringy.
        for (const [k, v] of Object.entries(parsed)) productVariants[k] = String(v)
      }
    } catch {
      // Malformed JSON ⇒ treat as no mapping rather than crash the route.
      productVariants = {}
    }
  }

  return {
    storeDomain: env.SHOPIFY_STORE_DOMAIN ?? '',
    storefrontToken: env.SHOPIFY_STOREFRONT_API_TOKEN ?? '',
    liveEnabled: (env.SHOPIFY_LIVE_ENABLED ?? '').toLowerCase() === 'true',
    productVariants,
  }
}

/** True when the store domain + token are present (live-add is *possible*). */
export function isShopifyConfigured(config: ShopifyConfig): boolean {
  return config.storeDomain.length > 0 && config.storefrontToken.length > 0
}

/** Resolve a template id to its configured variant id, or undefined. */
export function variantForTemplate(config: ShopifyConfig, templateId: string): string | undefined {
  return config.productVariants[templateId]
}
