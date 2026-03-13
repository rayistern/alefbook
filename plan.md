# Plan: Add LaTeX Book Support Alongside HTML

## Overview

Currently, every page is stored/edited/rendered as HTML (82 self-contained HTML files per template). Adding LaTeX support means introducing a **whole-book LaTeX format** as a parallel template type. A project is either HTML-based (per-page editing, current behavior) or LaTeX-based (single `.tex` document compiled as a whole book).

## Architecture: Whole-Book LaTeX

LaTeX expects one coherent document for proper page numbering, text overflow, cross-references, and typographic flow. A LaTeX template is a **single `.tex` file** that defines the entire book. The AI edits this file as a whole, XeLaTeX compiles it into a multi-page PDF, and the system splits that PDF into per-page PNGs for browser preview.

**Key decisions:**
- **XeLaTeX + polyglossia** for native Unicode, Hebrew/English bilingual support, and custom fonts via `fontspec`
- **Always PNG** for browser preview — both HTML and LaTeX render to PNG
- **Project-level format** — a project is `html` or `latex`, never mixed
- **Single source** — LaTeX projects store one `.tex` string, not 82 separate page states

---

## Step-by-step Implementation

### 1. Add XeLaTeX + tools to Docker image
**File:** `Dockerfile`

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-xetex \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-lang-hebrew \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*
```

- `texlive-xetex`: XeLaTeX engine + fontspec
- `texlive-latex-extra`: geometry, fancyhdr, titlesec, etc.
- `texlive-lang-hebrew`: polyglossia Hebrew support + Hebrew fonts
- `poppler-utils`: `pdftoppm` for PDF → PNG conversion
- No need for `latexmk` — we'll call `xelatex` directly (two passes for page numbers)

### 2. Database: add `format` and `latex_source` to projects
**Migration:**

```sql
ALTER TABLE projects
  ADD COLUMN format TEXT NOT NULL DEFAULT 'html',
  ADD COLUMN latex_source TEXT;
```

- `format`: `'html'` or `'latex'` — determines which pipeline the project uses
- `latex_source`: the full `.tex` document source for LaTeX projects (NULL for HTML projects)
- `page_states`: unchanged, still used for HTML projects (ignored for LaTeX projects)

### 3. Create LaTeX template files
**New directory:** `templates/haggadah-latex/`

```
templates/haggadah-latex/
├── template.json          # TemplateMeta with format: 'latex'
├── source.tex             # The full book .tex template
└── pages.json             # Page metadata (labels, sections — same structure)
```

**`source.tex`** — starter template:
```latex
\documentclass[10pt]{book}
\usepackage{geometry}
\geometry{paperwidth=152.4mm, paperheight=152.4mm, margin=18pt}

\usepackage{polyglossia}
\setdefaultlanguage{hebrew}
\setotherlanguage{english}

\usepackage{fontspec}
\setmainfont{FrankRuehl}
\newfontfamily\hebrewfont{FrankRuehl}

\usepackage{graphicx}
\usepackage{xcolor}
\usepackage{tikz}

\begin{document}

% Page 1: Front Cover
\thispagestyle{empty}
\begin{center}
{\Huge הגדה של פסח}
\end{center}
\newpage

% ... remaining pages ...

\end{document}
```

### 4. Update template loader
**File:** `lib/templates/loader.ts`

- Add `format` field to `TemplateMeta`: `format: 'html' | 'latex'`
- New function: `loadLatexSource(templateId)` — reads `source.tex`
- Update `loadPageHTML()` to handle LaTeX projects:
  - For LaTeX projects, the "source" is the project's `latex_source` column, not per-page HTML
  - Per-page content is derived by compiling → splitting, not by loading individual files

**File:** `lib/templates/page-state.ts`

- New functions:
  - `getLatexSource(projectId): Promise<string>` — fetch `latex_source` from project
  - `saveLatexSource(projectId, source: string): Promise<void>` — update `latex_source`
- Existing `savePageState`/`getPageStates` untouched (HTML projects only)

### 5. Create LaTeX rendering module
**New file:** `lib/rendering/latex.ts`

```typescript
export async function compileLatex(texSource: string): Promise<Buffer>
// Returns: PDF buffer
// 1. Write texSource to temp dir as book.tex
// 2. Run: xelatex --no-shell-escape -interaction=nonstopmode book.tex (twice for page numbers)
// 3. Read book.pdf, return as Buffer
// 4. Clean up temp dir

export async function pdfToPagePngs(pdfBuffer: Buffer): Promise<Map<number, Buffer>>
// Returns: map of page number → PNG buffer
// 1. Write PDF to temp file
// 2. Run: pdftoppm -png -r 300 book.pdf output
// 3. Read each output-NN.png, return as Map
// 4. Clean up

export async function renderLatexToPageImages(texSource: string): Promise<Map<number, Buffer>>
// Combines the above: compile → split into per-page PNGs
```

**Security:** Always run XeLaTeX with `--no-shell-escape`. Sanitize `.tex` input to strip `\write18`, `\immediate\write`, `\input{/...}` (absolute paths), `\catcode` tricks.

### 6. Update rendering dispatcher
**File:** `lib/rendering/puppeteer.ts`

Add a top-level dispatcher (or new file `lib/rendering/index.ts`):

```typescript
export async function renderPageToImage(
  content: string,
  format: 'html' | 'latex',
  pageNumber?: number
): Promise<Buffer> {
  if (format === 'html') return renderHTMLPageToImage(content) // existing
  // For LaTeX, compile full doc and extract the requested page
  const pages = await renderLatexToPageImages(content)
  return pages.get(pageNumber) ?? throw new Error(`Page ${pageNumber} not found`)
}
```

For LaTeX, compilation is expensive — cache the full compilation result and return individual pages from it. Use the existing `renders` table hash mechanism (hash the full `.tex` source).

### 7. Update AI editor for LaTeX
**File:** `lib/ai/html-editor.ts`

Add parallel functions (no renaming needed — keep HTML functions, add LaTeX ones):

```typescript
// New: parse the AI's LaTeX response
export function parseLatexBlock(responseText: string): string | null
// AI returns full .tex in a ```latex code block

// New: sanitize LaTeX source
export function sanitizeLatex(tex: string): string
// Strip: \write18, \immediate\write, \input{/absolute/path},
//        \catcode, \openout, \closeout, shell-escape commands

// New: validate LaTeX source
export function validateLatex(tex: string): { valid: boolean; warnings: string[] }
// Check: \begin{document} present, \end{document} present,
//        no \documentclass issues, balanced braces (basic check)
```

### 8. Update AI system prompt
**File:** `lib/ai/system-prompt.ts`

For LaTeX projects, build a different system prompt:
- Explain that the project is a whole-book LaTeX document
- AI receives the complete `.tex` source and returns the complete modified `.tex` source
- Use a single ` ```latex ` code block (not per-page blocks)
- Specify: XeLaTeX, polyglossia (Hebrew default, English other), fontspec for fonts
- List available fonts (from `/templates/fonts/`)
- List forbidden commands
- Specify page dimensions: 152.4mm × 152.4mm, 18pt margins (matching the HTML template)
- Encourage `\newpage` for page breaks, use comments like `% Page N: Label` for navigation

### 9. Update designer agent loop
**File:** `lib/ai/designer-agent.ts`

Branch early based on project format:

**For LaTeX projects:**
1. **Intent parsing**: Same as HTML — determine what the user wants
2. **Source generation**: Send full `.tex` source to AI, get back modified `.tex`
   - Parse with `parseLatexBlock()` instead of `parsePageHtmlBlocks()`
   - Sanitize with `sanitizeLatex()`
3. **Rendering**: Compile full `.tex` → PDF → per-page PNGs
   - Cache compilation by source hash
   - Upload all changed page PNGs to Supabase Storage
4. **Vision review**: Same as HTML — AI reviews rendered PNGs against instructions
   - If failed, loop with feedback (re-send full `.tex` + feedback)
5. **Save**: `saveLatexSource(projectId, texSource)` instead of `savePageStates()`

### 10. Update PDF compilation
**File:** `lib/rendering/pdf.ts`

For LaTeX projects, PDF compilation is trivial — XeLaTeX already produces a PDF:

```typescript
export async function compileProjectToPDF(projectId: string, format: 'html' | 'latex'): Promise<Buffer> {
  if (format === 'latex') {
    const source = await getLatexSource(projectId)
    return compileLatex(source) // Already a PDF!
  }
  // Existing HTML → Puppeteer → PDF logic
  return compileHTMLToPDF(pageStates)
}
```

This is a major advantage of the LaTeX approach — PDF export is a first-class output, not a screenshot-based workaround.

### 11. Update API routes
**File:** `app/api/render/route.ts`
- Fetch project format
- For LaTeX: compile full source, return per-page PNGs
- Cache aggressively (LaTeX compilation is slow ~5-10s)

**File:** `app/api/page-html/route.ts`
- For LaTeX projects: return a rendered PNG URL instead of HTML (or return a simple HTML wrapper that displays the PNG)
- The frontend already shows PNGs when `renderUrl` is available

**File:** `app/api/pdf/route.ts`
- Fetch project format, call `compileProjectToPDF()` with format

**File:** `app/api/project/route.ts`
- Accept `format` and `template_id` on creation
- Return `format` in project responses

### 12. Update frontend components
**Files:** `components/designer/PageViewer.tsx`, `DesignerShell.tsx`

Minimal changes needed:
- `PageViewer`: for LaTeX projects, always show PNG (never iframe). The component already supports this — it shows PNG when `renderUrl` is set.
- `DesignerShell`: on project load, if format is `latex`, trigger an initial full render to generate all page PNGs
- No need for a LaTeX source editor in the UI (the AI handles editing via chat)

---

## Schema Summary

```sql
ALTER TABLE projects
  ADD COLUMN format TEXT NOT NULL DEFAULT 'html',
  ADD COLUMN latex_source TEXT;
```

No other schema changes needed.

---

## Key Considerations

1. **Docker image size**: TeX Live adds ~500MB–1GB. Use `--no-install-recommends` and only the packages we need. Could explore a sidecar container later if size is a problem.
2. **Compilation speed**: XeLaTeX is slow (~5-10s for a full book, two passes). Cache aggressively by source hash. The AI edit loop may need 2-3 compilations per interaction (edit + review passes).
3. **Polyglossia + fontspec**: Polyglossia handles RTL/LTR switching natively. `\texthebrew{}` and `\textenglish{}` for inline switching. Font selection per language via `\newfontfamily\hebrewfont{...}`.
4. **Security**: Always `--no-shell-escape`. Sanitize AI output to strip dangerous commands. Run in temp directories with minimal permissions.
5. **PDF quality**: LaTeX PDF output is production-quality — proper vector text, kerning, ligatures, and page flow. This is the main advantage over HTML-to-PDF via Puppeteer.
6. **Font access**: XeLaTeX with fontspec can find system-installed fonts directly. Our custom fonts are already installed in the Docker image via `fc-cache`. Reference them by name in the `.tex` template.

---

## Implementation Order

1. Dockerfile (add XeLaTeX + poppler-utils)
2. Database migration (format + latex_source columns)
3. LaTeX rendering module (`lib/rendering/latex.ts`)
4. LaTeX template files (`templates/haggadah-latex/`)
5. Template loader updates
6. AI system prompt for LaTeX
7. AI editor functions (parse, sanitize, validate)
8. Designer agent loop (LaTeX branch)
9. API route updates
10. Frontend tweaks
11. PDF compilation update
