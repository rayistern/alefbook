# AlefBook v2

LaTeX-based book creation platform. Users chat with an AI agent that edits LaTeX across an entire book (50+ pages), compiles it to PDF, and displays the result. Users can share books publicly and fork each other's work.

## Quick Start (Local Dev)

```bash
npm install
cp .env.example .env.local   # fill in values (see below)
npm run dev                   # http://localhost:3000
```

> **Note**: LaTeX compilation requires TeX Live installed locally. On macOS: `brew install --cask mactex`. On Ubuntu: `sudo apt install texlive-xetex texlive-lang-hebrew texlive-latex-extra latexmk`. Without it, the chat/editor works but "Compile" will fail.

---

## Full Setup Guide

### 1. Supabase

You need a Supabase project. If you don't have one, create it at [supabase.com](https://supabase.com).

#### a) Run the database migration

Go to your Supabase dashboard → **SQL Editor** → paste the contents of `supabase/migrations/001_initial.sql` → click **Run**. This creates:

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles (auto-created on signup via trigger) |
| `projects` | Book projects with metadata |
| `messages` | Chat history per project |
| `tasks` | Agentic task tracking (plan, edit, compile steps) |
| `uploads` | User-uploaded images |

It also sets up Row Level Security so users can only access their own data (plus public projects are readable by everyone).

#### b) Create the storage bucket

Go to **Storage** → **New bucket**:
- **Name**: `projects`
- **Public**: No (we use signed URLs)
- **File size limit**: 50MB
- **Allowed MIME types**: leave blank (allow all)

Then add these **storage policies** on the `projects` bucket:

1. **SELECT** (download): Allow authenticated users to read files where the path starts with `projects/` and they own the project. For simplicity, you can allow all authenticated users to SELECT (the API layer handles access control).
2. **INSERT** (upload): Allow authenticated users.
3. **UPDATE**: Allow authenticated users.
4. **DELETE**: Allow authenticated users.

Quick approach — in the Storage Policies tab, click "New policy" → "For full customization" and add:
```sql
-- Allow all operations for authenticated users (API handles authorization)
CREATE POLICY "Authenticated users can manage project files"
ON storage.objects FOR ALL
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');
```

#### c) Enable auth providers

Go to **Authentication** → **Providers**:
- **Email**: Enabled by default. Works out of the box.
- **Google** (optional): Add your Google OAuth client ID and secret.
- **GitHub** (optional): Add your GitHub OAuth app credentials.

#### d) Get your keys

Go to **Settings** → **API**:
- `NEXT_PUBLIC_SUPABASE_URL` — the project URL (e.g., `https://abc123.supabase.co`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the `anon` / `public` key
- `SUPABASE_SERVICE_ROLE_KEY` — the `service_role` key (keep secret!)

### 2. OpenRouter

Get an API key at [openrouter.ai](https://openrouter.ai):
- `OPENROUTER_API_KEY` — your API key (starts with `sk-or-`)

This powers both the AI chat (LLM for planning and editing LaTeX) and image generation. Users pick models from a dropdown in the UI.

### 3. Upstash Redis (optional — rate limiting)

If you want rate limiting, create a Redis database at [upstash.com](https://upstash.com):
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

If you skip this, the app works fine but without rate limits.

### 4. Environment Variables

Copy `.env.example` to `.env.local` and fill in all values:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# OpenRouter
OPENROUTER_API_KEY=sk-or-...

# Upstash (optional)
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Deploying to Railway

Railway auto-deploys from GitHub when you push to the connected branch. There is **no manual deploy command needed** if you have GitHub integration set up.

### First-time Railway setup

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub Repo** → select `rayistern/alefbook`
2. Railway detects the `Dockerfile` automatically (configured in `railway.toml`)
3. Add all environment variables in the Railway dashboard under **Variables**:
   - All the env vars from above
   - Set `NEXT_PUBLIC_APP_URL` to your Railway domain (e.g., `https://haggadah.shluchimexchange.ai`)
   - **PORT** is set automatically by Railway (defaults to 8080, which our Dockerfile exposes)
4. Deploy happens automatically on push

### What the Dockerfile does

The Docker build installs TeX Live (~800MB) so LaTeX compilation works server-side:
- `texlive-xetex` — XeLaTeX engine (Unicode, system fonts)
- `texlive-lang-hebrew` — Hebrew language support
- `texlive-latex-extra` — Extra packages (tcolorbox, enumitem, etc.)
- `texlive-fonts-extra` — Additional fonts
- `latexmk` — Build automation
- Custom fonts from `templates/fonts/` are copied and registered

### Manual deploy (if not using GitHub integration)

```bash
# Install Railway CLI: npm install -g @railway/cli
railway login
railway link    # link to your project
railway up --detach
```

### Health check

Railway pings `/api/health` to verify the app is running. Configured in `railway.toml` with a 120-second timeout (TeX Live makes the image large, first boot takes a bit).

---

## Architecture Overview

### How the AI works

When a user sends a chat message, the agentic orchestrator (`lib/ai/orchestrator.ts`) runs a loop:

```
User message
    ↓
[1. PLANNER] — LLM analyzes the request, sees the book structure,
    ↓           creates a task list (edit pages, generate images, edit preamble)
    ↓
[2. EXECUTOR] — Runs each task:
    ↓   ├── edit_page: sends page LaTeX + instruction to LLM, saves updated .tex
    ↓   ├── edit_preamble: sends preamble + instruction to LLM, saves updated preamble.tex
    ↓   └── generate_image: calls image gen API, saves to project storage
    ↓
[3. COMPILER] — Downloads all .tex + images to temp dir
    ↓            Runs: latexmk -xelatex -interaction=nonstopmode main.tex
    ↓            Uploads compiled main.pdf to Supabase Storage
    ↓
[4. SELF-CORRECT] — If compilation fails, sends errors back to LLM
    ↓                LLM fixes the LaTeX, retries (up to 3 attempts)
    ↓
[5. DONE] — PDF URL returned to client, viewer refreshes
```

Progress is streamed to the UI via Server-Sent Events (SSE).

### Project file structure in Supabase Storage

```
projects/{projectId}/
├── main.tex              # Root doc: \documentclass, \input{preamble}, \input{pages/...}
├── preamble.tex          # Packages, fonts, macros, colors
├── pages/
│   ├── page-001.tex      # Individual page content
│   ├── page-002.tex
│   └── ...
├── images/               # Generated or uploaded images
│   └── gen-123456.png
└── output/
    └── main.pdf          # Compiled PDF
```

### Sharing & Forking

- Owner toggles "Public" in the share dialog
- Public projects appear at `/gallery` (sorted by newest or most forked)
- Anyone can view a public project's PDF at `/view/{id}`
- "Fork" creates a deep copy: new project record + copies all storage files
- `forked_from` tracks lineage, `fork_count` is incremented on the original

---

## API Routes

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/auth/signout` | POST | Yes | Sign out |
| `/api/auth/callback` | GET | No | OAuth callback |
| `/api/chat` | POST | Yes | Main agentic loop (SSE streaming) |
| `/api/compile` | POST | Yes | Trigger LaTeX compilation |
| `/api/project` | GET | Yes | List user's projects |
| `/api/project` | POST | Yes | Create new project |
| `/api/project/[id]` | GET | Mixed | Get project (owner or public) |
| `/api/project/[id]` | PATCH | Yes | Update project |
| `/api/project/[id]` | DELETE | Yes | Delete project + storage |
| `/api/project/[id]/fork` | POST | Yes | Fork a project |
| `/api/upload` | POST | Yes | Upload image to project |
| `/api/gallery` | GET | No | List public projects |
| `/api/health` | GET | No | Health check |

---

## Templates

Two starter templates available when creating a new book:

- **Blank** — Basic book with title page, FreeSerif font, minimal preamble
- **Hebrew-English** — Bilingual paracol layout with Hebrew fonts, RTL support, side-by-side columns

Templates are defined in `lib/latex/templates.ts` and generate `main.tex`, `preamble.tex`, and individual page files.
