# AlefBook — Architecture & Developer Guide

AlefBook is a Next.js 14 web application that lets users design personalized
Passover Haggadahs through natural-language conversation with an AI designer.
The AI edits page HTML, renders previews with Puppeteer, self-reviews via a
vision model, and iterates — producing print-ready 6″×6″ PDFs.

---

## Table of Contents

1. [High-Level Overview](#high-level-overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Authentication & Authorization](#authentication--authorization)
5. [Database Schema](#database-schema)
6. [Template System](#template-system)
7. [AI Designer Agent](#ai-designer-agent)
8. [Rendering Pipeline](#rendering-pipeline)
9. [Image Upload & Processing](#image-upload--processing)
10. [Frontend Components](#frontend-components)
11. [API Routes](#api-routes)
12. [Shopify Integration](#shopify-integration)
13. [Rate Limiting](#rate-limiting)
14. [Environment Variables](#environment-variables)
15. [Docker & Deployment](#docker--deployment)
16. [Data Flow Diagram](#data-flow-diagram)

---

## High-Level Overview

```
User (browser)
  │
  ├─ Clerk auth ──────────────────── Clerk (hosted)
  │
  ├─ Chat message ────────────────── /api/chat
  │   └─ AI Designer Loop ────────── OpenRouter (Claude 3.5 Sonnet)
  │       ├─ Generate HTML
  │       ├─ Render via Puppeteer ── Chromium (headless)
  │       └─ Vision review ──────── OpenRouter
  │
  ├─ Upload photo ────────────────── /api/upload → Sharp → Supabase Storage
  ├─ Preview/export PDF ──────────── /api/pdf → Puppeteer → Supabase Storage
  └─ Order print ─────────────────── Shopify checkout (cart-add redirect)
```

A user creates a project ("Haggadah"), opens the designer, and chats with the
AI. The AI determines which pages to modify, generates complete HTML for each
page, renders them to PNG via Puppeteer, and reviews the output with a vision
model. It iterates up to 5 times until the design passes review. Finished
designs are compiled to a multi-page PDF for download or Shopify print ordering.

---

## Tech Stack

| Layer          | Technology                                          |
| -------------- | --------------------------------------------------- |
| Framework      | Next.js 14 (App Router)                             |
| Language       | TypeScript 5                                        |
| Auth           | Clerk (`@clerk/nextjs`)                             |
| Database       | Supabase (PostgreSQL + Storage)                     |
| AI / LLM       | OpenRouter API (`anthropic/claude-3.5-sonnet`)      |
| Rendering      | Puppeteer-core + Chromium (headless)                |
| Image proc.    | Sharp                                               |
| Rate limiting  | Upstash Redis (sliding window)                      |
| UI components  | Radix UI, Tailwind CSS, Lucide icons                |
| E-commerce     | Shopify (cart-add redirect, no API integration)     |
| Deployment     | Docker (`node:20-slim` + Chromium)                  |

---

## Project Structure

```
alefbook/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout (ClerkProvider, TooltipProvider)
│   ├── page.tsx                  # Landing page (redirects authed → /dashboard)
│   ├── globals.css               # Global styles + CSS variables
│   ├── dashboard/page.tsx        # Project list & creation
│   ├── designer/[projectId]/     # Main designer page (server component)
│   ├── sign-in/[[...sign-in]]/   # Clerk sign-in
│   ├── sign-up/[[...sign-up]]/   # Clerk sign-up
│   └── api/
│       ├── chat/route.ts         # AI design endpoint
│       ├── render/route.ts       # Page → PNG rendering
│       ├── pdf/route.ts          # PDF compilation & export
│       ├── upload/route.ts       # Image upload & processing
│       ├── project/route.ts      # Project CRUD
│       ├── health/route.ts       # Health check
│       └── webhooks/clerk/       # Clerk → Supabase user sync
│
├── components/
│   ├── designer/                 # Designer UI components
│   │   ├── DesignerShell.tsx     # Main orchestrator (state, layout, handlers)
│   │   ├── ChatPanel.tsx         # Chat message list + input
│   │   ├── PageViewer.tsx        # Page render display + navigation
│   │   ├── Sidebar.tsx           # Photos + page thumbnail grid
│   │   └── PageThumbnail.tsx     # Individual page thumbnail
│   └── ui/                       # Shared UI primitives (Radix wrappers)
│
├── lib/
│   ├── ai/
│   │   ├── designer-agent.ts     # Core design loop (intent → edit → render → review)
│   │   ├── system-prompt.ts      # LLM system prompt builder
│   │   ├── html-editor.ts        # HTML parsing, validation, application
│   │   ├── review-criteria.ts    # Vision model review rubric
│   │   └── image-generation.ts   # (AI image gen, if used)
│   ├── rendering/
│   │   ├── puppeteer.ts          # HTML → PNG rendering (singleton browser)
│   │   └── pdf.ts                # Multi-page PDF compilation
│   ├── storage/
│   │   ├── supabase.ts           # Supabase client factory
│   │   └── uploads.ts            # Image processing & storage
│   ├── templates/
│   │   ├── loader.ts             # Template HTML loading with fallback chain
│   │   └── page-state.ts         # Page state persistence (CRUD)
│   ├── rate-limit/
│   │   └── upstash.ts            # Rate limit definitions
│   └── utils.ts                  # Tailwind cn() helper
│
├── templates/                    # Haggadah template assets
│   ├── metadata/
│   │   ├── template.json         # Template config (82 pages, 540×540px, etc.)
│   │   └── pages.json            # Page directory (section, label, editable, etc.)
│   ├── stubs/                    # Default HTML stubs (cover, interior, back)
│   └── fonts/                    # Custom Hebrew/English font files
│
├── middleware.ts                  # Clerk auth middleware (public vs protected routes)
├── Dockerfile                    # Production image (node:20 + Chromium + fonts)
├── next.config.mjs               # Image domains, server external packages
├── tailwind.config.ts            # Custom color system, dark mode
└── .env.example                  # Required environment variables
```

---

## Authentication & Authorization

### Clerk (User-Facing Auth)

- `ClerkProvider` wraps the entire app in `app/layout.tsx`.
- `middleware.ts` protects all routes except `/`, `/sign-in`, `/sign-up`,
  `/api/webhooks/*`, and `/api/health`.
- Every API route calls `auth()` from `@clerk/nextjs/server` to get the
  `userId` (Clerk ID).

### Clerk → Supabase User Sync

A webhook at `/api/webhooks/clerk` listens for `user.created` and
`user.updated` events. On receipt, it upserts `{ clerk_id, email }` into the
Supabase `users` table. Webhook signatures are verified via the Svix library.

### Resource Authorization

All API routes that access projects verify ownership by joining the `projects`
table with `users` on `clerk_id` before proceeding.

### Shopify

There is **no** Clerk-to-Shopify account linking. When a user orders a print,
they are redirected to Shopify as a guest customer. See
[Shopify Integration](#shopify-integration).

---

## Database Schema

Supabase PostgreSQL. Schema is managed via the Supabase dashboard (no migration
files in the repo).

### Tables

#### `users`
| Column     | Type   | Notes                        |
| ---------- | ------ | ---------------------------- |
| id         | uuid   | PK, auto-generated           |
| clerk_id   | text   | Unique, from Clerk webhook   |
| email      | text   |                              |

#### `projects`
| Column          | Type      | Notes                                      |
| --------------- | --------- | ------------------------------------------ |
| id              | uuid      | PK                                         |
| user_id         | uuid      | FK → users.id                              |
| name            | text      | e.g. "The Cohen Family Haggadah"           |
| status          | text      | draft / completed / ordered                |
| template_id     | text      | e.g. "haggadah-he-en-v1"                   |
| page_states     | jsonb     | `{ "1": "<html>...", "5": "<html>..." }`   |
| variant_options | jsonb     | Template variant config                    |
| created_at      | timestamp |                                            |
| updated_at      | timestamp |                                            |

#### `messages`
| Column       | Type      | Notes                                |
| ------------ | --------- | ------------------------------------ |
| id           | uuid      | PK                                   |
| project_id   | uuid      | FK → projects.id                     |
| role         | text      | "user" or "assistant"                |
| content      | text      | Message text                         |
| page_context | int       | Which page the user was viewing      |
| created_at   | timestamp |                                      |

#### `renders` (cache)
| Column      | Type | Notes                                |
| ----------- | ---- | ------------------------------------ |
| project_id  | uuid | FK → projects.id                     |
| page_number | int  |                                      |
| html_hash   | text | MD5 of the page HTML                 |
| image_path  | text | Supabase Storage path                |

#### `uploads`
| Column               | Type | Notes                              |
| -------------------- | ---- | ---------------------------------- |
| id                   | uuid | PK                                 |
| project_id           | uuid | FK → projects.id                   |
| filename             | text | Original filename                  |
| storage_path_display | text | 800px version for UI               |
| storage_path_print   | text | Full-res version for PDF           |
| width                | int  | Original dimensions                |
| height               | int  |                                    |

### Storage Buckets (Supabase Storage)

| Bucket    | Contents                                                  |
| --------- | --------------------------------------------------------- |
| `renders` | Cached page PNGs at `projects/{id}/renders/page-{n}.png` |
| `exports` | Generated PDFs at `projects/{id}/export.pdf`             |
| `uploads` | User photos: `projects/{id}/uploads/{uuid}-{display\|print}.jpg` |

---

## Template System

### Template Metadata

`templates/metadata/template.json` defines the Haggadah structure:

```json
{
  "template_id": "haggadah-he-en-v1",
  "name": "Hebrew-English Haggadah",
  "page_count": 82,
  "page_width_px": 540,
  "page_height_px": 540,
  "bleed_px": 18,
  "binding": "perfect",
  "languages": ["he", "en"]
}
```

### Page Directory

`templates/metadata/pages.json` lists all 82 pages with metadata:

```json
{
  "page_number": 15,
  "label": "Family Dedication",
  "section": "front-matter",
  "is_fixed_liturgy": false,
  "content_summary": "Customizable dedication page",
  "has_image_slots": true
}
```

**Sections:** cover, front-matter, seder, maggid, songs, extras, back-matter.

**Fixed liturgy pages** (Kadesh, Karpas, Maggid, Hallel, etc.) cannot have
their text content modified by the AI. The AI can only adjust styling and layout
on these pages.

### HTML Page Format

Every page is a self-contained HTML document:

- **Dimensions:** 540×540px visible area with 18px internal padding (bleed)
- **Required:** `data-page-number` attribute on the `.page` wrapper
- **CSS variables:** `--primary-color`, `--secondary-color`, `--background-color`,
  `--text-color`, `--font-hebrew`, `--font-english`
- **Hebrew text:** `dir="rtl"`, uses `--font-hebrew`
- **English text:** `dir="ltr"`, uses `--font-english`
- **Image slots:** 200×200px dashed border containers with `data-slot-id`
- **No `<script>` tags** — no JavaScript allowed in page HTML
- **No external URLs** except `/templates/`, `/uploads/`, `/api/`, `data:` URIs

### HTML Loading Fallback Chain

`lib/templates/loader.ts` → `loadPageHTML(pageNumber, projectState?)`:

1. Project-specific state (previously edited HTML from DB)
2. Default page file from `templates/pages/page-{n}.html` (if exists)
3. Stub fallback: `cover-stub.html`, `interior-stub.html`, or `back-stub.html`
   with page number injected

---

## AI Designer Agent

**Location:** `lib/ai/designer-agent.ts`

The core design loop that powers the chat-based designer. Called from
`/api/chat`.

### Model Configuration

- **Primary model:** `anthropic/claude-3.5-sonnet` via OpenRouter
- **Fallback:** `openai/gpt-4o`
- **Temperature:** 0.3
- **Max tokens:** 8192

### Design Loop (`runDesignerLoop`)

```
User message
    │
    ▼
1. PARSE INTENT
   AI determines which pages to modify and
   distills the user's request into clear instructions.
   Output: { targetPages: [1, 15], instructions: "..." }
    │
    ▼
2. GENERATE HTML  ◄────────────────────────┐
   AI receives current page HTML +          │
   instructions (+ review feedback if       │
   retrying) and produces complete           │
   updated HTML in code blocks.              │
    │                                        │
    ▼                                        │
3. VALIDATE & APPLY                          │
   Parse HTML blocks, validate              │
   (data-page-number, no scripts,            │
   no external URLs, 540px bounds).          │
   Invalid pages fall back to original.      │
    │                                        │
    ▼                                        │
4. RENDER                                    │
   Puppeteer renders each target page        │
   to 576×576 PNG (2x retina).               │
    │                                        │
    ▼                                        │
5. VISION REVIEW                             │
   Vision model evaluates renders against    │
   review criteria (layout, typography,      │
   images, design consistency).              │
   Output: { passed, issues[], feedback }    │
    │                                        │
    ├─ passed=true ──► DONE                  │
    │                                        │
    └─ passed=false ─► Loop (max 5 passes) ──┘
    │
    ▼
6. PERSIST
   Save updated page states to Supabase.
   Upload render PNGs to Supabase Storage.
```

### Review Criteria

The vision model checks:

- **Layout:** No overflows, content within safe zone (5px from edge), no
  unintended overlap, bleed area is background only
- **Typography:** Hebrew with nikud visible, RTL correct, min 10pt, no tofu
  boxes, 1.6× line-height
- **Images:** No white gaps, `object-fit: cover`, no clipped subjects
- **Design:** Sufficient contrast, consistent style, intentional appearance

### System Prompt

Built by `lib/ai/system-prompt.ts`. Includes:

- Template metadata (page count, dimensions, bleed)
- Full page directory (82 pages with sections and editability)
- List of uploaded photo filenames
- Current page HTML
- AI capabilities and constraints
- Output format instructions (complete HTML in ` ```page-html:N ``` ` blocks)

---

## Rendering Pipeline

### HTML → PNG (`lib/rendering/puppeteer.ts`)

`renderPageToImage(html: string): Promise<Buffer>`

- Singleton Chromium browser instance (reused across requests)
- Viewport: 576×576px, `deviceScaleFactor: 2` (retina)
- `waitUntil: 'networkidle0'` + `document.fonts.ready`
- Returns PNG buffer (576×576 clip)
- Executable: `/usr/bin/chromium` (or `PUPPETEER_EXECUTABLE_PATH`)
- Sandbox disabled for server environment

### HTML → PDF (`lib/rendering/pdf.ts`)

`compileToPDF(pageStates: Record<number, string>): Promise<Buffer>`

- Iterates all pages in order
- Extracts `<body>` from each page HTML
- Wraps in page-wrapper divs with `page-break-after: always`
- `@page` size: 152.4mm × 152.4mm (6″ square), zero margins
- Renders via Puppeteer with `printBackground: true`
- Returns PDF buffer

### Render Caching

The `/api/render` route caches renders by MD5 hash of the page HTML:

1. Hash the current HTML for the requested page
2. Check `renders` table for matching `(project_id, page_number, html_hash)`
3. If cached, return the stored Supabase Storage URL
4. If not, render via Puppeteer, upload PNG, insert cache row

---

## Image Upload & Processing

**Location:** `lib/storage/uploads.ts`, `app/api/upload/route.ts`

### Upload Flow

1. Client sends `FormData` with file and `projectId`
2. Validate: JPEG, PNG, HEIC, or HEIF only; max 20MB
3. Sharp creates two versions:
   - **Display:** max 800×800px, quality 85 (for UI thumbnails)
   - **Print:** full resolution, quality 95 (for PDF output)
4. Both uploaded to Supabase Storage under
   `projects/{projectId}/uploads/{uuid}-{display|print}.jpg`
5. Metadata inserted into `uploads` table

### Usage in Designer

Uploaded photos appear in the Sidebar. Clicking a photo sends a chat message
like "Place this photo on page X", which the AI handles by inserting the image
into an `<img>` tag or image slot in the page HTML.

---

## Frontend Components

### Page Layout

**Desktop (≥768px):** Three-column layout

```
┌──────────────┬──────────────┬──────────────┐
│  ChatPanel   │  PageViewer  │   Sidebar    │
│              │              │              │
│  Messages    │  540×540     │  My Photos   │
│  + Input     │  render      │  + Upload    │
│              │  + nav       │              │
│              │              │  All Pages   │
│              │              │  (thumbnails)│
└──────────────┴──────────────┴──────────────┘
```

**Mobile (<768px):** Tab-based (Chat / Page / Photos)

### DesignerShell (`components/designer/DesignerShell.tsx`)

The main orchestrator. Manages all state:

- `currentPage` — which page is selected
- `messages` — chat history
- `uploads` — uploaded photos
- `renders` — render URLs per page
- `editedPages` — set of page numbers that have been modified
- `isWorking` / `passInfo` — AI processing state

Handlers:
- `handleSendMessage(text)` → `POST /api/chat`
- `handleUpload(file)` → `POST /api/upload`
- `renderPage(pageNum)` → `POST /api/render`
- `handlePreviewPdf()` → `POST /api/pdf`
- `handleOrderPrint()` → generate PDF, redirect to Shopify

### ChatPanel (`components/designer/ChatPanel.tsx`)

- Scrollable message list (user = right/blue, assistant = left/gray)
- Textarea input with Cmd/Ctrl+Enter to send
- Shows "Designing... (pass X/5)" during AI processing
- Disabled while working

### PageViewer (`components/designer/PageViewer.tsx`)

- Displays 540×540px rendered page image
- Prev/Next page navigation
- Loading shimmer overlay during rendering
- "Preview PDF" and "Order Print" buttons

### Sidebar (`components/designer/Sidebar.tsx`)

- **My Photos:** Upload button + grid of uploaded images (clickable)
- **All Pages:** 4-column grid of `PageThumbnail` components
- Green dot on pages that have been edited

---

## API Routes

### `POST /api/chat` — AI Design Endpoint

```
Auth: Clerk required
Rate limit: 30/hour (aiCalls)
Body: { message: string, projectId: string, currentPage: number }
Response: {
  responseText: string,
  updatedPages: Record<number, string>,   // page HTML
  renderUrls: Record<number, string>,     // PNG URLs
  passCount: number,
  reviewPassed: boolean
}
```

Orchestrates the full design loop: saves user message, loads context, runs
`runDesignerLoop()`, saves assistant response, caches renders.

### `POST /api/render` — Page Rendering

```
Auth: Clerk required
Body: { projectId: string, pageNumbers: number[] }
Response: { renderUrls: Record<number, string> }
```

Renders specific pages to PNG with MD5-based caching.

### `POST /api/pdf` — PDF Export

```
Auth: Clerk required
Rate limit: 5/hour (pdfExports)
Body: { projectId: string }
Response: { pdfUrl: string, path: string }
```

Compiles all pages to a single PDF. Returns a 24-hour signed URL.

### `POST /api/upload` — Image Upload

```
Auth: Clerk required
Rate limit: 20/hour (uploads)
Body: FormData { file, projectId }
Response: { id, filename, storage_path_display, storage_path_print, width, height }
```

### `GET/POST/PATCH/DELETE /api/project` — Project CRUD

- **GET** `?id=xxx` — single project; no param — list all user projects
- **POST** `{ name?, template_id? }` — create project
- **PATCH** `{ id, ...updates }` — update project
- **DELETE** `?id=xxx` — delete project

### `POST /api/webhooks/clerk` — User Sync

Svix-verified webhook. Handles `user.created` and `user.updated` events,
upserting `{ clerk_id, email }` into `users` table.

### `GET /api/health`

Returns `{ status: 'ok', timestamp }`. Public (no auth).

---

## Shopify Integration

**Status: Minimal — cart-add redirect only.**

When a user clicks "Order Print":

1. The app generates a PDF and uploads it to Supabase Storage
2. The user is redirected to Shopify via a cart-add URL:

```
https://alefbook.myshopify.com/cart/add
  ?id={SHOPIFY_HAGGADAH_VARIANT_ID}
  &properties[pdf_url]={encodedPdfUrl}
  &properties[project_id]={projectId}
```

The user completes checkout on Shopify as a **guest customer**. There is no
Clerk-to-Shopify account linking, no Shopify Admin/Storefront API integration,
and no order-status webhooks from Shopify.

---

## Rate Limiting

**Location:** `lib/rate-limit/upstash.ts`

Uses Upstash Redis sliding-window rate limiting per user:

| Bucket        | Limit       |
| ------------- | ----------- |
| AI calls      | 30 / hour   |
| Image gen     | 10 / hour   |
| PDF exports   | 5 / hour    |
| Uploads       | 20 / hour   |

`checkLimit(type, userId)` returns `{ allowed: boolean, retryAfterSeconds? }`.

---

## Environment Variables

```bash
# AI — OpenRouter API key for Claude/GPT calls
OPENROUTER_API_KEY=

# Supabase — database and file storage
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Clerk — authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=

# Upstash — rate limiting
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Puppeteer — headless browser for rendering
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Shopify — print ordering (optional)
SHOPIFY_STORE_URL=https://alefbook.myshopify.com
SHOPIFY_HAGGADAH_VARIANT_ID=

# App
NEXT_PUBLIC_APP_URL=https://alefbook.org
```

---

## Docker & Deployment

**`Dockerfile`** builds a production image:

1. Base: `node:20-slim`
2. Installs Chromium + rendering dependencies (libatk, libgtk, libnss, etc.)
3. Copies custom fonts from `templates/fonts/`, rebuilds font cache
4. Sets `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` (uses system Chromium)
5. `npm ci` → `COPY . .` → `npm run build` → `npm prune --production`
6. Exposes port 3000, starts with `npm start`

**Key system dependencies** in the Docker image:
`chromium`, `fonts-liberation`, `libatk-bridge2.0-0`, `libgtk-3-0`, `libnss3`,
`libxss1`, `ca-certificates`

---

## Data Flow Diagram

```
                         ┌─────────────┐
                         │   Browser   │
                         └──────┬──────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                  │
         Sign in/up        Chat message        Upload photo
              │                 │                  │
              ▼                 ▼                  ▼
         ┌────────┐     ┌──────────┐       ┌──────────┐
         │ Clerk  │     │ /api/chat│       │/api/upload│
         └───┬────┘     └────┬─────┘       └────┬─────┘
             │               │                   │
             │    ┌──────────┴──────────┐        │
             │    │  runDesignerLoop()  │        │
             │    │                     │        │
             │    │  1. parseIntent()   │        │
             │    │  2. generateHTML()  │   ┌────┴─────┐
             │    │  3. validate()      │   │  Sharp   │
             │    │  4. render(puppt.)  │   │ process  │
             │    │  5. review(vision)  │   └────┬─────┘
             │    │  6. iterate/save    │        │
             │    └──────────┬──────────┘        │
             │               │                   │
     ┌───────┴───────────────┴───────────────────┴───────┐
     │                    Supabase                        │
     │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
     │  │  users   │  │ projects │  │  Storage         │ │
     │  │ messages │  │ renders  │  │  (PNGs, PDFs,    │ │
     │  │ uploads  │  │          │  │   photos)        │ │
     │  └──────────┘  └──────────┘  └──────────────────┘ │
     └───────────────────────────────────────────────────┘
```
