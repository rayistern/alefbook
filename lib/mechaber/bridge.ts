/**
 * Mechaber → alefbook typesetting bridge (the integration seam).
 *
 * ─── Why this module exists ─────────────────────────────────────────────────
 * Portfolio decision B5 (see the alefbook issue "Decision: make alefbook
 * Torah-specific + integrate mechaber typesetting"): alefbook is the
 * Torah/seforim publishing surface, and mechaber (merkos-302/mechaber — the
 * educator source-builder) is its natural upstream author. Mechaber's own
 * export layer (`frontend/src/studio/export/exportModel.ts`) is an
 * `ExportAdapter` registry whose PDF path is Paged.js / browser print — good
 * for handouts, NOT print-grade. alefbook's XeLaTeX pipeline IS print-grade
 * (trim, bleed, real fonts, press-ready PDF). This module is the contract that
 * lets a mechaber artifact become an alefbook book: a typeset, sellable,
 * physically printable sefer / source booklet.
 *
 * ─── The seam, concretely ───────────────────────────────────────────────────
 * mechaber registers a new ExportAdapter (target id `alefbook-print`) that
 * serializes its flow-document (BlockNote blocks) into the transport-neutral
 * `MechaberTypesetRequest` below and POSTs it to alefbook's (planned)
 * `/api/typeset` endpoint, which creates a project from the payload using
 * `mechaberRequestToLatex()` and returns the project/PDF URL. Full phased plan:
 * `docs/MECHABER_INTEGRATION.md`.
 *
 * ─── Design principles ──────────────────────────────────────────────────────
 * 1. **No god-IR.** Mechaber's export architecture deliberately refuses a
 *    universal document model; we respect that. This payload is a small,
 *    versioned, flow-document-only vocabulary (heading / paragraph / source /
 *    callout / page-break) — the subset that makes sense on paper. Design
 *    canvases are out of scope for v1.
 * 2. **Pure module.** No `fs`, no network, no Node-only imports — same rule as
 *    `lib/templates/registry.ts` — so it is unit-testable and importable from
 *    anywhere. The (future) `/api/typeset` route owns storage + auth.
 * 3. **Static-text discipline carries over.** A mechaber `source` block is a
 *    quoted mekor (Torah source). The converter renders it verbatim inside a
 *    visually-distinct block; nothing in this pipeline invents or paraphrases
 *    sacred text — the text arrives from mechaber, which got it from the
 *    Torah API. alefbook only typesets it.
 * 4. **Versioned contract.** `version: 1` is required so both sides can evolve
 *    without silent misinterpretation (backward-compatibility-by-default rule).
 */

// ─── The wire contract (what mechaber sends) ─────────────────────────────────

/**
 * One content block of a mechaber flow document, reduced to the print-relevant
 * subset. This intentionally mirrors the *shape* of what mechaber's export
 * adapters consume (BlockNote blocks flattened per family), not BlockNote's own
 * JSON — mechaber's adapter does the flattening on its side so alefbook never
 * depends on a rich-text library's internals.
 */
export type MechaberBlock =
  | {
      /** Section/subsection heading. Level 1 maps to \section*, 2 → \subsection*, 3 → \subsubsection*. */
      type: 'heading'
      level: 1 | 2 | 3
      text: string
      /** 'he' renders RTL in the Hebrew font; default 'en'. */
      lang?: 'he' | 'en'
    }
  | {
      /** Plain running text (teacher's own words — commentary, instructions, chidushim). */
      type: 'paragraph'
      text: string
      lang?: 'he' | 'en'
    }
  | {
      /**
       * A quoted Torah source ("mekor") — the heart of a mechaber source sheet.
       * Rendered as a framed source block: citation header, Hebrew text (RTL),
       * optional translation underneath. `he`/`en` are verbatim quotations;
       * the converter must never alter them beyond LaTeX-escaping.
       */
      type: 'source'
      /** Human citation, e.g. "Bereishis 1:1" or "Likkutei Sichos vol. 5, p. 62". */
      citation: string
      /** The Hebrew source text (verbatim). */
      he?: string
      /** English translation (verbatim). */
      en?: string
    }
  | {
      /** A teacher's callout/annotation box (discussion question, instruction). */
      type: 'callout'
      title?: string
      text: string
      lang?: 'he' | 'en'
    }
  | {
      /** Explicit page break requested by the author. */
      type: 'page-break'
    }

/** Print setup subset — mirrors `TemplateDocumentSetup` in lib/templates/registry.ts. */
export interface MechaberDocumentSetup {
  pageWidthIn: number
  pageHeightIn: number
  /** Languages present, for font setup; defaults to ['he', 'en']. */
  languages?: string[]
}

/**
 * The full typeset request a mechaber `alefbook-print` export adapter sends.
 * Everything alefbook needs to create a project and compile a print-grade PDF.
 */
export interface MechaberTypesetRequest {
  /** Contract version. Bump only with a compatibility shim on the receiving side. */
  version: 1
  artifact: {
    /** Mechaber-side artifact id, kept for provenance/round-tripping. */
    id?: string
    /** Only flow documents are typesettable in v1 (no god-IR — see header). */
    family: 'flow-doc'
    title: string
    /** Optional Hebrew title for the sha'ar (title page). */
    titleHe?: string
    /** Author/teacher display name for the title page. */
    author?: string
  }
  documentSetup?: MechaberDocumentSetup
  blocks: MechaberBlock[]
}

// ─── LaTeX generation ────────────────────────────────────────────────────────

/**
 * Escape user/mechaber-provided text for safe inclusion in LaTeX. This is a
 * plain-text policy — the v1 contract carries no inline formatting, so every
 * special character is literal content, never markup.
 *
 * Backslashes are swapped to a sentinel first and restored last: replacing
 * them directly with `\textbackslash{}` would let the brace-escaping pass
 * mangle the braces of our own replacement (a bug the unit test caught).
 * U+0000 is safe as the sentinel because it cannot appear in JSON string
 * payloads or legitimate text.
 */
export function latexEscape(text: string): string {
  return text
    .replace(/\\/g, '\u0000')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/\u0000/g, '\\textbackslash{}')
}

/** Wrap Hebrew text in the RTL environment defined by the generated preamble. */
function hebrewBlock(text: string): string {
  return `\\begin{hebrew}\n${latexEscape(text)}\n\\end{hebrew}`
}

/** Render one block to LaTeX. Kept as a pure per-block function for testability. */
export function blockToLatex(block: MechaberBlock): string {
  switch (block.type) {
    case 'heading': {
      const cmd = block.level === 1 ? 'section*' : block.level === 2 ? 'subsection*' : 'subsubsection*'
      // Hebrew headings render inside \texthebrew so the heading machinery
      // (spacing, font size) still applies while the text runs RTL.
      const text = block.lang === 'he' ? `\\texthebrew{${latexEscape(block.text)}}` : latexEscape(block.text)
      return `\\${cmd}{${text}}`
    }
    case 'paragraph':
      return block.lang === 'he' ? hebrewBlock(block.text) : latexEscape(block.text)
    case 'source': {
      // A framed mekor: citation label, Hebrew (RTL), then translation. The
      // tcolorbox-free implementation (plain framed minipage via mdframed-less
      // \fbox alternative) keeps package requirements to what the Docker TeX
      // Live image already installs.
      const parts: string[] = [
        `\\begin{mekor}{${latexEscape(block.citation)}}`,
      ]
      if (block.he) parts.push(hebrewBlock(block.he))
      if (block.he && block.en) parts.push('\\mekordivider')
      if (block.en) parts.push(latexEscape(block.en))
      parts.push('\\end{mekor}')
      return parts.join('\n')
    }
    case 'callout': {
      const title = block.title ? `[${latexEscape(block.title)}]` : ''
      const body = block.lang === 'he' ? hebrewBlock(block.text) : latexEscape(block.text)
      return `\\begin{callout}${title}\n${body}\n\\end{callout}`
    }
    case 'page-break':
      return '\\newpage'
  }
}

/**
 * Convert a full typeset request into a compilable XeLaTeX document.
 *
 * The preamble mirrors the house style of the registry generators
 * (`lib/latex/templates.ts`): FreeSerif via fontspec, native XeTeX bidi for
 * Hebrew, plus two small environments this bridge owns — `mekor` (framed
 * source block) and `callout` (annotation box). The output is a single
 * self-contained `main.tex` string, ready for the existing compile pipeline
 * (`lib/latex/compiler.ts`) with no images and no extra TEXINPUTS.
 *
 * Returns the same `{ main }` shape as `getTemplate()` so the future
 * `/api/typeset` route can reuse the project-creation path unchanged.
 */
export function mechaberRequestToLatex(request: MechaberTypesetRequest): { main: string } {
  if (request.version !== 1) {
    // Fail loudly rather than mis-typeset a future contract we don't understand.
    throw new Error(`Unsupported MechaberTypesetRequest version: ${String((request as { version: unknown }).version)}`)
  }
  if (request.artifact.family !== 'flow-doc') {
    throw new Error(`Unsupported artifact family: ${String(request.artifact.family)} (v1 typesets flow documents only)`)
  }

  const setup = request.documentSetup ?? { pageWidthIn: 7, pageHeightIn: 10 }

  const titlePage = [
    '%%% ---- Page 1 — Title Page (Sha\'ar) ----',
    '\\thispagestyle{empty}',
    '\\begin{center}',
    '\\vspace*{2cm}',
    '',
    ...(request.artifact.titleHe
      ? [`{\\hebrewfonttitle ${latexEscape(request.artifact.titleHe)}}`, '', '\\vspace{0.5cm}', '']
      : []),
    `{\\Huge\\bfseries ${latexEscape(request.artifact.title)}}`,
    '',
    ...(request.artifact.author
      ? ['\\vspace{1.5cm}', '', `{\\Large ${latexEscape(request.artifact.author)}}`, '']
      : []),
    '\\vfill',
    '',
    '{\\small Typeset with AlefBook}',
    '',
    '\\end{center}',
    '\\newpage',
  ].join('\n')

  const body = request.blocks.map(blockToLatex).join('\n\n')

  const main = `\\documentclass[11pt, openany]{book}

%%% Page geometry — driven by the mechaber documentSetup (print trim size)
\\usepackage[
  paperwidth=${setup.pageWidthIn}in,
  paperheight=${setup.pageHeightIn}in,
  inner=0.9in,
  outer=0.75in,
  top=0.8in,
  bottom=0.85in,
  headheight=14pt
]{geometry}

%%% Fonts (XeLaTeX with Hebrew support) — same stack as the registry generators
\\usepackage{fontspec}
\\setmainfont{FreeSerif}[Ligatures=TeX]
\\setsansfont{FreeSans}
\\newfontfamily\\hebrewfont[Script=Hebrew, Scale=1.15]{FreeSerif}
\\newfontfamily\\hebrewfonttitle[Script=Hebrew, Scale=2.0]{FreeSerif}

%%% Hebrew / RTL support (native XeTeX bidi)
\\newenvironment{hebrew}{%
  \\par\\begingroup\\hebrewfont\\TeXXeTstate=1\\beginR\\parindent=0pt\\relax
}{%
  \\endR\\endgroup\\par
}
\\newcommand{\\texthebrew}[1]{{\\hebrewfont\\TeXXeTstate=1\\beginR #1\\endR}}

%%% Colors
\\usepackage[dvipsnames]{xcolor}
\\definecolor{accent}{HTML}{1B3A5C}
\\definecolor{mekorframe}{HTML}{C5962A}
\\definecolor{muted}{HTML}{6B7280}

%%% Layout
\\usepackage{fancyhdr}
\\usepackage{parskip}
\\usepackage{setspace}

%%% The mekor (quoted Torah source) block: citation header + framed body.
%%% Implemented with a plain framed minipage so no packages beyond the
%%% Docker image's TeX Live set are needed.
\\newenvironment{mekor}[1]{%
  \\par\\medskip
  \\noindent{\\small\\color{muted}\\textsc{#1}}\\par\\nopagebreak\\smallskip
  \\noindent\\begingroup
  \\setlength{\\fboxsep}{10pt}%
  \\begin{minipage}{\\dimexpr\\linewidth-2\\fboxsep\\relax}
}{%
  \\end{minipage}\\endgroup\\par\\medskip
}
\\newcommand{\\mekordivider}{\\par\\smallskip\\noindent{\\color{mekorframe}\\rule{2cm}{0.5pt}}\\par\\smallskip}

%%% The callout (teacher annotation / discussion question) box.
\\newenvironment{callout}[1][]{%
  \\par\\medskip\\noindent\\begingroup\\small
  \\ifx\\relax#1\\relax\\else\\textbf{#1}\\par\\smallskip\\fi
}{%
  \\endgroup\\par\\medskip
}

%%% Headers & Footers
\\pagestyle{fancy}
\\fancyhf{}
\\renewcommand{\\headrulewidth}{0pt}
\\fancyfoot[C]{\\small\\thepage}

\\setlength{\\parskip}{6pt}
\\setlength{\\parindent}{0pt}

\\begin{document}

${titlePage}

${body}

\\end{document}
`

  return { main }
}
