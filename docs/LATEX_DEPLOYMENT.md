# LaTeX Support — Deployment Guide

## Overview

LaTeX support adds XeLaTeX-based whole-book typesetting alongside existing HTML per-page templates. A project is either HTML or LaTeX format — never mixed.

## Deployment Steps

### 1. Run the Database Migration

In the Supabase SQL Editor, run:

```sql
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'html',
  ADD COLUMN IF NOT EXISTS latex_source TEXT;

ALTER TABLE projects
  ADD CONSTRAINT projects_format_check CHECK (format IN ('html', 'latex'));
```

**Do existing projects need updating?** No. The `format` column defaults to `'html'`, so all existing projects automatically stay as HTML projects. The `latex_source` column is nullable and ignored for HTML projects.

### 2. Deploy the Docker Image

The updated Dockerfile installs:
- `texlive-xetex` — XeLaTeX engine + fontspec
- `texlive-latex-extra` — geometry, fancyhdr, titlesec, tcolorbox, etc.
- `texlive-fonts-recommended` — FreeSerif, FreeSans (used by the template)
- `texlive-lang-hebrew` — Hebrew font support
- `texlive-lang-other` — provides `bidi.sty` (required by polyglossia for RTL)
- `poppler-utils` — `pdftoppm` for PDF → PNG conversion

This adds ~500MB–1GB to the Docker image. The first build will be slower.

### 3. Verify

After deployment:
1. Existing HTML projects should work unchanged
2. Create a new project with `template_id: 'haggadah-he-en-latex-v1'` to test LaTeX
3. The chat AI will use the LaTeX system prompt and return `.tex` edits

## Architecture

### How it works

```
User chat message
  → AI receives full .tex source + instructions
  → AI returns modified .tex in ```latex block
  → XeLaTeX compiles .tex → PDF (two passes)
  → pdftoppm splits PDF → per-page PNGs
  → PNGs uploaded to Supabase Storage
  → Frontend displays PNGs (same as HTML projects)
```

### Storage

| Field | HTML projects | LaTeX projects |
|-------|--------------|----------------|
| `format` | `'html'` | `'latex'` |
| `page_states` | `{"1": "<html>...", ...}` | `{}` (unused) |
| `latex_source` | `NULL` | Full `.tex` document |

### Files added

```
lib/rendering/latex.ts        — XeLaTeX compilation + PDF→PNG
lib/ai/latex-editor.ts        — Parse, sanitize, validate LaTeX
templates/haggadah-latex/      — LaTeX template (source.tex + template.json)
migrations/001_add_latex_support.sql — Schema migration
docs/LATEX_HAGGADAH_GUIDELINES.md   — Template design & content guidelines
```

### Files modified

- `Dockerfile` — added TeX Live packages
- `lib/templates/loader.ts` — multi-template support
- `lib/templates/page-state.ts` — LaTeX source CRUD
- `lib/ai/system-prompt.ts` — LaTeX-specific AI prompt
- `lib/ai/designer-agent.ts` — LaTeX branch in design loop
- `app/api/chat/route.ts` — format-aware
- `app/api/render/route.ts` — LaTeX rendering path
- `app/api/pdf/route.ts` — native XeLaTeX PDF export
- `app/api/page-html/route.ts` — placeholder for LaTeX projects
- `app/api/project/route.ts` — format on creation
- `app/designer/[projectId]/page.tsx` — passes format to frontend
- `components/designer/DesignerShell.tsx` — format prop
- `components/designer/PageViewer.tsx` — no iframe for LaTeX

## Template Details

The LaTeX template (`templates/haggadah-latex/source.tex`) uses:
- **Polyglossia + bidi.sty** for proper RTL support (paragraph-level alignment, inline mixed bidi)
- **Custom environments**: `hebrewblock`, `englishblock`, `\instruction{}`, `\sedersection{}`
- **pgfornament** for decorative elements
- **tcolorbox** for styled instruction boxes
- **7" × 10"** page size (classic Jewish book proportion)

See `docs/LATEX_HAGGADAH_GUIDELINES.md` for full details on the design system, custom commands, content editing rules, and printing specs.
