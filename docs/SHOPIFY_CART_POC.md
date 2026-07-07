# Shopify Cart Write-Back (POC)

**Status:** ALEF2 proof-of-concept. Config-driven, mock-tested, **no live-store
calls**. See the ALEF1 recon, "Answer 1":
`batches/audits/alefbook-shopify-mechaber-recon-2026-07-06.md` (chatbuilds repo).

## The pattern

alefbook.org is a Shopify store. The recon's verdict: keep Shopify as the
commerce layer and make the designer an **external app that hands a configured
line item back to the native cart** — exactly how photobook services
(Shutterfly / Mixbook) integrate. The designer produces a print-ready PDF, then
adds the product variant to the cart **with line-item properties** carrying a
reference to the design. Checkout, payment, taxes, and fulfillment stay 100%
native Shopify. This POC builds that line item; it does **not** touch the money
path.

```
designer → compile PDF → POST /api/cart → { variant + line-item properties }
                                              → (client) POST /cart/add.js
                                              → native Shopify checkout
                                              → order-created webhook (future)
                                                 reads _alefbook_pdf_url → print
```

## Files

- `lib/shopify/config.ts` — env-driven config (store domain, Storefront token,
  live-enable flag, `templateId → variantId` map). Nothing hardcoded.
- `lib/shopify/cart.ts` — the payload builders + the privacy gate + `addToCart`
  (live-call-gated, injectable `fetch`).
- `app/api/cart/route.ts` — auth + ownership-gated endpoint that builds and
  returns the configured line item.
- `lib/shopify/__tests__/cart.test.ts` — all network mocked; asserts the payload
  shape, the privacy whitelist, and that **no live call happens** unless
  explicitly enabled + configured.

## Config (env)

No live-store credentials are assumed. These are documented here and belong in
`.env.example` / Railway service variables (the `.env.example` edit was blocked
by the sensitive-file guard — add them there when authorized):

| Var | Meaning | Default |
|---|---|---|
| `SHOPIFY_STORE_DOMAIN` | e.g. `alefbook.myshopify.com` | *(empty ⇒ unconfigured)* |
| `SHOPIFY_STOREFRONT_API_TOKEN` | Storefront API token (server→cart) | *(empty)* |
| `SHOPIFY_LIVE_ENABLED` | `"true"` permits real network calls | `false` |
| `SHOPIFY_PRODUCT_VARIANTS` | JSON `{ "<templateId>": "<variantId>" }` | `{}` |

## The two safety gates (why no live call can happen by accident)

`addToCart` performs a real network request **only** when BOTH:

1. `SHOPIFY_LIVE_ENABLED=true`, AND
2. the store is configured (domain + token present).

Otherwise it returns the built payload in **mock mode** with no fetch. Tests and
the manual smoke path both run in mock mode, so CI and a stray prod deploy can
never hit the live store.

## Privacy gate

Line-item properties are visible in the cart, at checkout, and in order exports
— a data-egress surface. Enforced:

1. **Auth + ownership** (`app/api/cart/route.ts`): you must be signed in, and the
   project must be *yours*. Someone else's `projectId` returns 404 (not 403, so
   we don't confirm its existence).
2. **Whitelist** (`buildLineItemProperties` / `sanitizeLineItemProperties`): only
   four underscore-prefixed reference keys can ever be emitted —
   `_alefbook_project_id`, `_alefbook_template_id`, `_alefbook_pdf_url`,
   `_alefbook_page_count`. Anything else is dropped. The underscore hides them
   from the storefront cart UI while still riding to the order.
3. **Reference, not content**: the PDF is a **short-lived signed URL** (1h, via
   `getProjectPdfUrl`), never the raw file, LaTeX source, chat, or any customer
   PII.

## Manual smoke path (no live store)

1. Sign in; create + compile a project (so it has a PDF).
2. `POST /api/cart` with `{ "projectId": "<your project id>" }`.
3. With no Shopify env set, the response is:
   ```json
   { "status": "mock-live-disabled", "live": false,
     "payload": { "items": [ { "id": "...", "quantity": 1,
       "properties": { "_alefbook_project_id": "...", "_alefbook_pdf_url": "...", ... } } ] } }
   ```
   (If `SHOPIFY_PRODUCT_VARIANTS` has no entry for the template, you get a 422
   with a clear "No Shopify variant configured" message — expected until a real
   store maps variants.)
4. A same-origin storefront (App Proxy page or `designer.alefbook.org`) posts
   that `payload` to `/cart/add.js` to add it to the native cart.

## Out of scope (future)

- The order-created webhook that reads `_alefbook_pdf_url` and routes to print
  fulfillment.
- App Proxy HMAC/session plumbing vs the simpler `designer.alefbook.org`
  subdomain (recon Answer 1 — a Rayi decision, issue #22).
- Real variant ids (needs the live store).
