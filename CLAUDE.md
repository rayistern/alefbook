# Claude Code Instructions

## Shell Commands
- Never use `&&` to chain shell commands. Run each command separately.

## Project
- Next.js 14 app deployed to Railway via Docker.
- GitHub: github.com/rayistern/alefbook

## Architecture
AlefBook v2 is a **LaTeX-based book creation platform**. Users chat with an AI agent that edits LaTeX across an entire book (50+ pages). Simple UI: chat panel + PDF canvas.

### Stack
- **Framework**: Next.js 14 (App Router)
- **Auth**: Supabase Auth (email/password + OAuth)
- **Database**: Supabase Postgres
- **Storage**: Supabase Storage (LaTeX sources + compiled PDFs)
- **LaTeX**: TeX Live (XeLaTeX) compiled server-side in Docker
- **AI**: OpenRouter (user-selectable model via dropdown)
- **Image Gen**: OpenRouter (user-selectable model)
- **PDF Viewer**: react-pdf (pdf.js)
- **UI**: Tailwind + Radix primitives
- **Rate Limit**: Upstash Redis
- **Deploy**: Railway via Docker

### Key Directories
- `app/` — Next.js App Router pages and API routes
- `components/` — React components (chat, pdf, project, ui)
- `lib/ai/` — AI orchestration (planner, page editor, image gen, OpenRouter client)
- `lib/latex/` — LaTeX compilation pipeline and templates
- `lib/supabase/` — Supabase client helpers (browser + server)
- `supabase/migrations/` — SQL schema
- `templates/fonts/` — Custom fonts installed in Docker

### Agentic Orchestration (lib/ai/orchestrator.ts)
The AI operates in a **plan-execute-compile** loop:
1. **Planner**: Analyzes user request, creates task list (edit pages, generate images, edit preamble)
2. **Executor**: Runs tasks sequentially — calls LLM for each page edit, generates images
3. **Compiler**: Runs `latexmk -xelatex` server-side, uploads PDF to Supabase Storage
4. **Self-correction**: If compilation fails, AI reads errors and fixes (up to 3 retries)
5. **Streaming**: Task progress streamed to UI via SSE

### Database Schema (supabase/migrations/001_initial.sql)
- `profiles` — extends auth.users
- `projects` — book projects (name, page_count, status, is_public, forked_from, etc.)
- `messages` — chat history per project
- `tasks` — agentic task tracking
- `uploads` — user-uploaded images

### LaTeX Compilation (lib/latex/compiler.ts)
1. Downloads all .tex + images from Supabase Storage to temp dir
2. Runs `latexmk -xelatex -interaction=nonstopmode -halt-on-error main.tex`
3. On success: uploads main.pdf to Supabase Storage
4. On failure: parses log for errors, returns to AI for self-correction

### Project Structure in Storage
Each project stores files as:
```
projects/{projectId}/
├── main.tex
├── preamble.tex
├── pages/page-001.tex ... page-NNN.tex
├── images/
└── output/main.pdf
```

### Sharing & Forking
- Users toggle projects to public → appears in /gallery
- Fork = deep copy of all LaTeX files + images
- forked_from field tracks lineage, fork_count incremented

### Templates (lib/latex/templates.ts)
- `blank` — basic book with title page
- `hebrew-english` — bilingual paracol layout, Hebrew fonts, RTL support

## Railway
- Deploy with `railway up --detach`
- Health check: `/api/health`
- Dockerfile builds with TeX Live (texlive-xetex, texlive-lang-hebrew, etc.)

## Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENROUTER_API_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
NEXT_PUBLIC_APP_URL=
```

## API Routes
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/signout` | POST | Sign out |
| `/api/auth/callback` | GET | OAuth callback |
| `/api/chat` | POST | Main agentic loop (SSE) |
| `/api/compile` | POST | Trigger LaTeX compilation |
| `/api/project` | GET/POST | List/create projects |
| `/api/project/[id]` | GET/PATCH/DELETE | Project CRUD |
| `/api/project/[id]/fork` | POST | Fork a project |
| `/api/upload` | POST | Upload image |
| `/api/gallery` | GET | List public projects |
| `/api/health` | GET | Health check |
