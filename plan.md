# Plan: Add LaTeX File Support Alongside HTML

## Overview

Currently, every page is stored/edited/rendered as HTML. Adding LaTeX support means introducing a **parallel content format** so pages (or entire templates) can be authored in LaTeX, compiled to PDF/PNG, and participate in the same AI-edit → render → review loop.

## Architecture Decision: Dual-Format Pages

Each page gets a `format` field (`"html"` or `"latex"`). The rendering pipeline branches on this field, but everything upstream (storage, AI loop, PDF export) stays unified.

---

## Step-by-step Implementation

### 1. Add a LaTeX compiler to the Docker image
**File:** `Dockerfile`

Install TeX Live (minimal scheme + required packages) alongside Chromium:
```dockerfile
RUN apt-get update && apt-get install -y texlive-base texlive-latex-extra \
    texlive-fonts-recommended texlive-lang-hebrew texlive-xetex latexmk
```
Use XeLaTeX for native Unicode/Hebrew support with custom fonts.

### 2. Introduce a `PageFormat` type and update storage
**File:** `lib/templates/loader.ts`

- Add `format: 'html' | 'latex'` to `PageMeta`.
- Update `loadPageHTML` → `loadPageContent` to also look for `.tex` files:
  ```
  templates/haggadah/pages/page-001.html  (existing)
  templates/haggadah/pages/page-001.tex   (new, if LaTeX)
  ```
- The function returns `{ content: string; format: 'html' | 'latex' }`.

**File:** `lib/templates/page-state.ts`

- Update `page_states` shape: value becomes `{ content: string; format: 'html' | 'latex' }` (or keep string for HTML backward-compat and store LaTeX with a prefix/wrapper).
- Simpler approach: add a separate `page_formats` JSONB column (`Record<string, 'html' | 'latex'>`) to `projects` table, defaulting to `'html'`.

### 3. Create a LaTeX rendering module
**New file:** `lib/rendering/latex.ts`

```typescript
export async function renderLatexToImage(latex: string): Promise<Buffer>
export async function renderLatexToPDF(latex: string): Promise<Buffer>
```

Implementation:
1. Write `.tex` content to a temp directory.
2. Copy project fonts into the temp directory (or reference them via fontspec paths).
3. Run `xelatex` via `child_process.execFile` with a timeout.
4. Read the resulting `.pdf`, then use `sharp` or `pdftoppm` to convert to PNG for preview.
5. Clean up temp files.

### 4. Update the unified rendering dispatcher
**File:** `lib/rendering/puppeteer.ts` → extract to `lib/rendering/index.ts`

Create a dispatcher:
```typescript
export async function renderPageToImage(
  content: string,
  format: 'html' | 'latex'
): Promise<Buffer> {
  if (format === 'latex') return renderLatexToImage(content)
  return renderHTMLToImage(content)  // existing Puppeteer logic
}
```

Update all call sites (`designer-agent.ts`, `render/route.ts`).

### 5. Update the AI editor for LaTeX
**File:** `lib/ai/html-editor.ts` → rename to `lib/ai/page-editor.ts`

- Add `parsePageLatexBlocks()` alongside `parsePageHtmlBlocks()`:
  ```
  ```page-latex:12
  \documentclass{article}
  ...
  ```
  ```
- Add `sanitizePageLatex()` — strip `\input`, `\write18`, `\immediate`, shell-escape commands.
- Add `validatePageLatex()` — ensure `\begin{document}` present, etc.
- Create a unified `parsePageBlocks()` that detects both formats.

### 6. Update the AI system prompt
**File:** `lib/ai/system-prompt.ts`

Add a LaTeX section to the system prompt:
- Explain when to use `page-latex:N` vs `page-html:N` code blocks.
- Provide LaTeX constraints (XeLaTeX, fontspec for fonts, geometry for page size, bidi for Hebrew RTL).
- List forbidden LaTeX commands (`\write18`, `\input{/etc/...}`, etc.).

### 7. Update the designer agent loop
**File:** `lib/ai/designer-agent.ts`

- In `generateHTMLEdits` (rename to `generatePageEdits`):
  - Parse both HTML and LaTeX blocks from AI response.
  - Apply appropriate sanitizer based on format.
- In `renderPages`: pass format to the dispatcher.
- In `reviewRender`: no changes needed (it reviews PNG images regardless of source format).

### 8. Update the PDF compilation
**File:** `lib/rendering/pdf.ts`

- For mixed-format books: compile LaTeX pages to individual PDFs, then use a PDF merge tool (`pdfunite` or a Node library like `pdf-lib`) to interleave HTML-rendered and LaTeX-rendered pages.
- For all-LaTeX books: compile a single multi-page `.tex` document directly.

### 9. Update API routes
**Files:** `app/api/render/route.ts`, `app/api/page-html/route.ts`

- `render/route.ts`: accept `format` parameter, dispatch accordingly.
- `page-html/route.ts` → rename or extend to `page-content/route.ts`: return `{ content, format }`.

### 10. Update frontend components
**Files:** `components/designer/PageViewer.tsx`, `DesignerShell.tsx`

- `PageViewer`: for LaTeX pages, display the rendered PNG instead of an iframe (LaTeX can't be displayed in a browser directly).
- Or: always show the rendered PNG regardless of format (simpler, unified UX).

---

## Database Migration

```sql
ALTER TABLE projects
  ADD COLUMN page_formats JSONB DEFAULT '{}';
-- page_formats: { "1": "html", "5": "latex", ... }
-- Missing entries default to "html"
```

---

## Key Considerations

1. **Docker image size**: TeX Live adds ~500MB–1GB. Use `texlive-base` + only needed packages to minimize. Alternatively, consider a sidecar container for LaTeX compilation.
2. **Compilation speed**: XeLaTeX is slower than Puppeteer rendering (~2-5s per page vs <1s). Cache aggressively using the existing `renders` table hash mechanism.
3. **Hebrew support**: XeLaTeX + `bidi` + `fontspec` handles Hebrew RTL natively and produces superior typographic output compared to HTML/CSS.
4. **Security**: LaTeX has shell-escape capabilities. Always run with `--no-shell-escape` and sanitize user/AI content to strip dangerous commands.
5. **Backward compatibility**: Existing HTML templates and saved page states continue to work unchanged. LaTeX is purely additive.
