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

## Page Editability (Locking Pages)

Pages can be individually locked to prevent AI editing. This is configured per-page in `templates/metadata/pages.json` via the `editable` field.

### How it works

- **Configuration**: Set `"editable": false` on any page entry in `templates/metadata/pages.json` to lock it. Default is `true`.
- **UI behavior**: When a user navigates to a locked page:
  - An amber warning banner appears above the preview: *"[Page Label] is not editable. This page is locked and cannot be modified."*
  - A lock icon badge appears on the page render.
  - The page thumbnail in the sidebar shows a small lock icon.
- **AI behavior**: The AI system prompt includes the `editable` flag for every page. If the user asks the AI to edit a locked page:
  - The designer agent filters it out of the target pages before generating HTML.
  - If *all* requested pages are locked, the AI returns a message explaining the pages are locked.
  - As a defense-in-depth measure, the server also strips any page-html blocks the AI returns for non-editable pages.

### Future enhancements

- Per-project overrides: Allow `editable` overrides stored in `projects.variant_options` so different projects can have different locked pages without changing the template.
- Admin UI: Add a settings panel in the designer to toggle page editability visually instead of editing JSON.

## Autosave Indicator Completeness

The autosave indicator currently tracks:
- Title renames (saved via `PATCH /api/project`)
- Chat-driven design changes (saved server-side during `/api/chat`)

To make it fully comprehensive:
- If any future client-side editing features are added (direct text editing, drag-and-drop layout), those changes will need explicit save calls to the backend
- Consider adding a periodic heartbeat or `beforeunload` warning if there are unsaved changes
