# Next Steps (Backend/Infrastructure Required)

The following items from the UI improvement pass require backend or infrastructure changes before they can be fully implemented.

## Add to Cart Button

The "Order Print" button already exists in the designer header but only appears when `SHOPIFY_HAGGADAH_VARIANT_ID` and `SHOPIFY_STORE_URL` environment variables are set. To make it visible:

1. Configure the Shopify store and create a product variant for Haggadah prints
2. Set the environment variables:
   - `SHOPIFY_HAGGADAH_VARIANT_ID` — the Shopify variant ID for the printed Haggadah
   - `SHOPIFY_STORE_URL` — the Shopify store base URL (e.g. `https://store.alefbook.com`)
3. Consider adding the button in a more prominent location (e.g. a floating CTA or a dedicated "Finish & Order" step) once the Shopify integration is live

## Dashboard Project Thumbnails (Optimization)

The current implementation fetches cover thumbnails client-side by calling `/api/render` for each project on the dashboard. This works but could be optimized:

1. Add a `cover_render_url` or `cover_image_path` column to the `projects` table
2. Update the render pipeline to cache the first page render URL on the project record
3. Return the cover URL directly from `GET /api/project` to avoid N+1 render calls on dashboard load
4. Alternatively, create a dedicated `GET /api/project/thumbnails?ids=...` batch endpoint

## Autosave Indicator Completeness

The autosave indicator currently tracks:
- Title renames (saved via `PATCH /api/project`)
- Chat-driven design changes (saved server-side during `/api/chat`)

To make it fully comprehensive:
- If any future client-side editing features are added (direct text editing, drag-and-drop layout), those changes will need explicit save calls to the backend
- Consider adding a periodic heartbeat or `beforeunload` warning if there are unsaved changes
