# AlefBook v2 — LaTeX Book Creator

## Overview
Rebuild AlefBook as a LaTeX-based book creation platform. Users chat with an AI agent that edits LaTeX across an entire book (50+ pages). Simple UI: chat panel + PDF canvas. Users can share creations and fork others' work.

---

## Tech Stack

| Layer | Tech | Notes |
|-------|------|-------|
| Framework | Next.js 14 (App Router) | Keep current |
| Auth | Supabase Auth | Replace Clerk |
| Database | Supabase (Postgres) | Keep, new schema |
| Storage | Supabase Storage | LaTeX sources + compiled PDFs |
| LaTeX | TeX Live (server-side Docker) | Full install for paracol, Hebrew, etc. |
| AI | OpenRouter | Keep current, agentic loop |
| Image Gen | OpenRouter (user-selectable model) | Dropdown in UI |
| PDF Viewer | react-pdf / pdf.js | Display compiled PDFs |
| UI | Tailwind + Radix | Keep current primitives |
| Rate Limit | Upstash Redis | Keep current |
| Deploy | Railway via Docker | Keep current |

---

## Architecture

### 1. Project Structure (files on disk & in Supabase Storage)

Each project = a LaTeX book stored as:
```
projects/{projectId}/
├── main.tex              # Root document (\documentclass, \input pages)
├── preamble.tex          # Packages, macros, fonts, styles
├── pages/
│   ├── page-001.tex      # Individual page files
│   ├── page-002.tex
│   └── ...
├── images/
│   ├── img-001.png       # Generated or uploaded images
│   └── ...
├── output/
│   └── main.pdf          # Compiled PDF
└── history/
    └── ...               # Version snapshots (optional)
```

All LaTeX source files are stored in Supabase Storage. Compilation happens server-side: download sources → run `latexmk` → upload PDF.

### 2. Database Schema

**users** (Supabase Auth handles this, but we add a profiles table)
```sql
profiles:
  id          UUID (PK, = auth.users.id)
  display_name TEXT
  avatar_url   TEXT
  created_at   TIMESTAMP
```

**projects**
```sql
projects:
  id              UUID (PK)
  user_id         UUID (FK → profiles)
  name            TEXT
  description     TEXT
  page_count      INT
  is_public       BOOLEAN (default false)
  forked_from     UUID (FK → projects, nullable)
  fork_count      INT (default 0)
  template_id     TEXT (nullable — starter template used)
  status          TEXT ('draft', 'compiling', 'ready', 'error')
  pdf_url         TEXT (signed URL to latest compiled PDF)
  thumbnail_url   TEXT (cover page thumbnail)
  latex_engine    TEXT (default 'xelatex')
  created_at      TIMESTAMP
  updated_at      TIMESTAMP
```

**messages**
```sql
messages:
  id              UUID (PK)
  project_id      UUID (FK → projects)
  role            TEXT ('user', 'assistant', 'system')
  content         TEXT
  metadata        JSONB (pages affected, action type, etc.)
  created_at      TIMESTAMP
```

**tasks** (for agentic orchestration — tracks multi-step operations)
```sql
tasks:
  id              UUID (PK)
  project_id      UUID (FK → projects)
  message_id      UUID (FK → messages)
  type            TEXT ('plan', 'edit_page', 'generate_image', 'compile', 'review')
  status          TEXT ('pending', 'running', 'done', 'failed')
  page_number     INT (nullable)
  input           JSONB
  output          JSONB
  error           TEXT (nullable)
  created_at      TIMESTAMP
  completed_at    TIMESTAMP
```

**uploads**
```sql
uploads:
  id              UUID (PK)
  project_id      UUID (FK → projects)
  filename        TEXT
  storage_path    TEXT
  width           INT
  height          INT
  created_at      TIMESTAMP
```

### 3. Agentic Orchestration (The Core)

The AI agent operates in a **plan-execute-review** loop:

```
User message
    ↓
[1. PLANNER] — Analyzes request, creates a task plan
    ↓           e.g., "Change all images to cartoon style"
    ↓           → Plan: generate 12 cartoon images, update 12 pages, compile
    ↓
[2. EXECUTOR] — Executes tasks sequentially/in parallel:
    ↓   ├── generate_image(page 3, "cartoon style illustration of...")
    ↓   ├── generate_image(page 7, "cartoon style illustration of...")
    ↓   ├── ... (can batch where possible)
    ↓   ├── edit_page(page 3, "replace \includegraphics path")
    ↓   ├── edit_page(page 7, "replace \includegraphics path")
    ↓   └── ...
    ↓
[3. COMPILER] — Runs latexmk, produces PDF
    ↓
[4. REVIEWER] — AI checks compiled PDF (vision), reports issues
    ↓
[5. RESPONSE] — Streams progress + final result to user
```

**Key design decisions:**
- Tasks stream progress to the UI via Server-Sent Events (SSE)
- Each task is logged in the `tasks` table for auditability
- The planner sees the full book structure (page list + summaries) but not all LaTeX at once
- Individual page edits send only that page's LaTeX to the AI
- Failed tasks can be retried without re-running the whole plan
- The agent can self-correct: if compilation fails, it reads the error log and fixes

### 4. LaTeX Compilation Pipeline

**Docker setup:**
```dockerfile
# Add to Dockerfile:
RUN apt-get install -y texlive-full  # or a curated subset:
# texlive-xetex texlive-lang-hebrew texlive-latex-extra
# texlive-fonts-extra texlive-bibtex-extra latexmk
```

**Compilation flow:**
1. Download all project .tex + images from Supabase Storage to a temp dir
2. Run: `latexmk -xelatex -interaction=nonstopmode -halt-on-error main.tex`
3. On success: upload `main.pdf` to Supabase Storage, update project status
4. On failure: parse log for errors, return to AI for self-correction (up to 3 retries)
5. Clean up temp dir

**Why XeLaTeX:** Native Unicode (Hebrew), system font support, modern package compatibility.

### 5. UI — Minimal & Off-the-Shelf

```
┌─────────────────────────────────────────────────┐
│  AlefBook          [Share] [Fork] [Download PDF] │
├──────────────────┬──────────────────────────────┤
│                  │                              │
│   Chat Panel     │      PDF Canvas              │
│   (left side)    │      (react-pdf)             │
│                  │                              │
│   - Messages     │   - Page navigation          │
│   - Task progress│   - Zoom/pan                 │
│   - Model picker │   - Page thumbnails strip    │
│                  │                              │
│   [Upload image] │                              │
│   [Message input]│                              │
│                  │                              │
├──────────────────┴──────────────────────────────┤
│  Task progress bar: "Generating image 3/12..."   │
└─────────────────────────────────────────────────┘
```

**Components:**
- `ChatPanel` — message history, input, file upload, model dropdown
- `PdfViewer` — react-pdf wrapper with zoom, page nav, thumbnail strip
- `TaskProgress` — shows current agentic operation progress
- `ShareDialog` — toggle public/private, copy share link
- `GalleryPage` — browse public books, fork button

### 6. Sharing & Forking

**Share flow:**
1. User toggles project to "public"
2. Project appears in gallery at `/gallery`
3. Other users can view the PDF (read-only)
4. "Fork" button creates a deep copy:
   - Copy all LaTeX files + images in Supabase Storage
   - Create new project record with `forked_from` = original
   - Increment `fork_count` on original
   - User can now freely edit their fork

**Gallery page (`/gallery`):**
- Grid of public projects with cover thumbnails
- Sort by: newest, most forked
- Click to preview PDF, fork button

### 7. Starter Templates

Ship a few built-in LaTeX templates:
- **Blank book** — empty 10-page document with basic preamble
- **Hebrew-English book** — paracol setup, Hebrew fonts, RTL support
- **Photo book** — image-heavy layout with captions
- **Story book** — chapter-based with title pages

Templates stored in `templates/` directory, copied to new projects on creation.

### 8. API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/callback` | GET | Supabase auth callback |
| `/api/chat` | POST | Main agentic loop (SSE streaming) |
| `/api/compile` | POST | Trigger LaTeX compilation |
| `/api/project` | CRUD | Project management |
| `/api/project/[id]/fork` | POST | Fork a project |
| `/api/upload` | POST | Upload image to project |
| `/api/gallery` | GET | List public projects |
| `/api/health` | GET | Health check |

### 9. Environment Variables

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# OpenRouter
OPENROUTER_API_KEY=

# Upstash (rate limiting)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# App
NEXT_PUBLIC_APP_URL=
```

---

## Implementation Plan (Phases)

### Phase 1: Foundation (scaffold + LaTeX pipeline)
1. Clean the repo — remove old HTML template system, Clerk, Puppeteer code
2. Set up Supabase Auth (replace Clerk middleware)
3. Create new database schema (run migrations)
4. Build LaTeX compilation pipeline (`lib/latex/compiler.ts`)
5. Create Dockerfile with TeX Live
6. Build project CRUD API + storage structure
7. Create starter LaTeX templates

### Phase 2: Agentic AI Loop
1. Build planner agent (`lib/ai/planner.ts`)
2. Build page editor agent (`lib/ai/page-editor.ts`)
3. Build image generator (`lib/ai/image-gen.ts`)
4. Build compiler integration + error recovery
5. Build reviewer agent (vision check on compiled PDF)
6. Wire up SSE streaming for task progress
7. Build the `/api/chat` orchestration endpoint

### Phase 3: UI
1. Build PdfViewer component (react-pdf)
2. Build ChatPanel with streaming + task progress
3. Build project dashboard (create, list, delete)
4. Build designer page layout (chat + PDF canvas)
5. Add model selector dropdown
6. Add image upload flow

### Phase 4: Sharing & Community
1. Build share toggle + public gallery
2. Build fork functionality
3. Add cover thumbnail generation
4. Build gallery page with browsing/sorting

### Phase 5: Polish & Deploy
1. Rate limiting
2. Error handling & edge cases
3. Mobile responsiveness
4. Railway deployment + health checks
5. Update CLAUDE.md
