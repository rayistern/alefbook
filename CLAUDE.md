# Claude Code Instructions

## Shell Commands
- Never use `&&` to chain shell commands. Run each command separately.
- The working directory is `C:/Scripts/git/alefbook/alefbook`.

## Project
- Next.js 14 app deployed to Railway via Docker.
- Git repo root is the `alefbook/` inner directory (that's where `.git` lives).
- GitHub: github.com/rayistern/alefbook

## Railway
- Project: brilliant-wholeness, service: alefbook
- Domain: alefbook-production.up.railway.app
- Deploy with `railway up --detach` from the project directory.
- Build logs: `railway logs --build`, runtime logs: `railway logs`
- Health check: `/api/health`
- The CLI sometimes shows FAILED even when the deploy is live — verify by hitting the health endpoint.
- Environment variables are set in Railway (Clerk, Supabase, OpenRouter, Upstash, Puppeteer, Shopify).

## Architecture
- Clerk for auth, Supabase for DB + storage, Puppeteer for HTML-to-PNG rendering.
- Templates: `templates/haggadah/pages/` (40 HTML files, some with 'r' suffix like page-002r.html).
- Template metadata says 82 pages total; pages 41-82 use stubs.
- Fonts: `templates/fonts/` — installed as system fonts in Docker, also served via `public/fonts/`.
- Images: `images/` — served via `public/images/`.
- Static thumbnails: `public/thumbnails/` (extracted from HaggadahPamphlet.pdf via `scripts/extract-thumbnails.mjs`).
- HTML asset paths are rewritten in `lib/templates/loader.ts` at load time.
- Supabase storage uses signed URLs (not public URLs) for renders and uploads.

## Page Editability
- Each page in `templates/metadata/pages.json` has an `editable` field (boolean).
- Pages with `editable: false` are **locked**: the AI cannot modify them, and the UI shows a warning banner + lock icon instead of allowing edits.
- To lock/unlock a page, change its `editable` value in `pages.json`. All pages default to `true`.
- Enforcement happens at three levels:
  1. **UI**: `PageViewer` shows a lock warning; `PageThumbnail` shows a lock icon.
  2. **AI prompt**: The system prompt tells the AI which pages are non-editable.
  3. **Server**: `designer-agent.ts` filters non-editable pages from intent targets and strips any page-html blocks the AI returns for locked pages.

## Key Files
- `Dockerfile` — builds with Chromium for Puppeteer, copies fonts/images to public/
- `lib/templates/loader.ts` — loads HTML templates, rewrites asset paths, injects font spinner
- `lib/rendering/puppeteer.ts` — server-side HTML-to-PNG with base href injection
- `components/designer/DesignerShell.tsx` — main designer 3-panel layout
- `components/designer/ChatPanel.tsx` — AI chat sidebar
- `railway.toml` — health check config
