import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { getBookTemplate, type BookTemplate } from '@/lib/templates/registry'

export interface TemplateImage {
  /** Path relative to project storage, e.g. "newImages_whitebg/kaarah1a.png" */
  storagePath: string
  /** Absolute path on disk */
  diskPath: string
}

export interface TemplateFiles {
  main: string
  images?: TemplateImage[]
}

/**
 * Procedural document generators, keyed by the `generator` id declared on a
 * registry entry's `asset` descriptor. Kept here (server-side) rather than in
 * the pure-data registry so the registry stays importable from client code.
 */
const GENERATORS: Record<string, (pageCount: number) => string> = {
  blank: blankDoc,
  'hebrew-english': hebrewEnglishDoc,
}

/**
 * Resolve a template id + page count into its LaTeX source (+ any bundled
 * images). Fully data-driven: it reads the registry entry (issue #14) and
 * dispatches on the declared asset kind — a pre-authored `source.tex` file, or
 * a named procedural generator. Adding a book is now a registry row plus (for
 * file-backed books) a source.tex; no edit here is required.
 *
 * Falls back to the `blank` generator for an unknown id, preserving the old
 * switch's default behaviour.
 */
export function getTemplate(templateId: string, pageCount: number): TemplateFiles {
  const template = getBookTemplate(templateId)
  if (!template) {
    return { main: blankDoc(pageCount) }
  }

  if (template.asset.kind === 'generator') {
    const generate = GENERATORS[template.asset.generator]
    // Unknown generator id ⇒ blank fallback (defensive; registry is authored).
    return { main: (generate ?? blankDoc)(pageCount) }
  }

  // File-backed template: read the pre-authored source + enumerate its images.
  return fileTemplate(template)
}

/**
 * Read a file-backed template's `source.tex` and collect its bundled images
 * from the registry-declared `imageDirs`. Images are stored under a flat
 * "images/" prefix (de-duplicated by filename) so they land in one directory —
 * this avoids non-deterministic TEXINPUTS recursive search order when the same
 * filename appears in multiple source dirs.
 */
function fileTemplate(template: BookTemplate): TemplateFiles {
  if (template.asset.kind !== 'file') {
    // Unreachable given the caller's dispatch; keeps the type narrow.
    return { main: blankDoc(10) }
  }
  const sourcePath = path.join(process.cwd(), template.asset.path)
  const main = readFileSync(sourcePath, 'utf-8')

  const seen = new Set<string>()
  const images: TemplateImage[] = []
  for (const dir of template.imageDirs) {
    const dirPath = path.join(process.cwd(), dir)
    try {
      const files = readdirSync(dirPath)
      for (const file of files) {
        if (/\.(png|jpg|jpeg|pdf)$/i.test(file) && !seen.has(file)) {
          seen.add(file)
          images.push({
            storagePath: `images/${file}`, // flat — no subdir ambiguity
            diskPath: path.join(dirPath, file),
          })
        }
      }
    } catch {
      // Directory doesn't exist / no images for this template — fine.
    }
  }

  return { main, images }
}

function blankDoc(pageCount: number): string {
  const pages = Array.from({ length: pageCount }, (_, i) => {
    const n = i + 1
    if (n === 1) {
      return `%%% ---- Page ${n} — Title Page ----
\\thispagestyle{empty}
\\begin{center}
\\vspace*{3cm}

{\\Huge\\bfseries My Book}

\\vspace{1cm}

{\\Large A new creation}

\\vspace{2cm}

{\\large Author Name}

\\vfill

{\\small Created with Shluchim Exchange}

\\end{center}
\\newpage`
    }
    return `%%% ---- Page ${n} ----
\\section*{Page ${n}}

Your content goes here. You can ask the AI to help you write and format this page.

\\newpage`
  }).join('\n\n')

  return `\\documentclass[11pt, openany]{book}

%%% Page geometry
\\usepackage[
  paperwidth=7in,
  paperheight=10in,
  inner=0.9in,
  outer=0.75in,
  top=0.8in,
  bottom=0.85in,
  headheight=14pt
]{geometry}

%%% Fonts (XeLaTeX)
\\usepackage{fontspec}
\\setmainfont{FreeSerif}[Ligatures=TeX]
\\setsansfont{FreeSans}

%%% Colors
\\usepackage[dvipsnames]{xcolor}
\\definecolor{accent}{HTML}{2563EB}
\\definecolor{muted}{HTML}{6B7280}

%%% Graphics
\\usepackage{graphicx}
\\usepackage{tikz}

%%% Layout
\\usepackage{fancyhdr}
\\usepackage{titlesec}
\\usepackage{setspace}
\\usepackage{parskip}
\\usepackage{hyperref}

\\hypersetup{
  colorlinks=false,
  pdfborder={0 0 0},
}

%%% Headers & Footers
\\pagestyle{fancy}
\\fancyhf{}
\\renewcommand{\\headrulewidth}{0pt}
\\fancyfoot[C]{\\small\\thepage}

%%% Spacing
\\setlength{\\parskip}{6pt}
\\setlength{\\parindent}{0pt}

\\begin{document}

${pages}

\\end{document}
`
}

function hebrewEnglishDoc(pageCount: number): string {
  const pages = Array.from({ length: pageCount }, (_, i) => {
    const n = i + 1
    if (n === 1) {
      return `%%% ---- Page ${n} — Title Page ----
\\thispagestyle{empty}
\\begin{center}
\\vspace*{2cm}

{\\Huge\\bfseries My Book}

\\vspace{0.5cm}

{\\hebrewfonttitle ספר שלי}

\\vspace{2cm}

{\\Large Author Name}

\\vspace{0.3cm}

{\\large\\hebrewfont שם המחבר}

\\vfill

{\\small Created with Shluchim Exchange}

\\end{center}
\\newpage`
    }
    if (n % 2 === 0) {
      return `%%% ---- Page ${n} — Bilingual spread ----
\\begin{paracol}{2}
\\switchcolumn[0]

% English column (left)
\\section*{Chapter ${Math.floor(n / 2)}}

English text goes here. The AI can help you write content in both languages.

\\switchcolumn[1]

% Hebrew column (right)
\\begin{hebrew}
{\\Large פרק ${Math.floor(n / 2)}}

\\vspace{0.5em}

טקסט בעברית כאן. הבינה המלאכותית יכולה לעזור לכתוב תוכן בשתי השפות.
\\end{hebrew}

\\end{paracol}
\\newpage`
    }
    return `%%% ---- Page ${n} ----

Content for page ${n}.

\\newpage`
  }).join('\n\n')

  return `\\documentclass[11pt, openany]{book}

%%% Page geometry
\\usepackage[
  paperwidth=7in,
  paperheight=10in,
  inner=0.9in,
  outer=0.75in,
  top=0.8in,
  bottom=0.85in,
  headheight=14pt
]{geometry}

%%% Fonts (XeLaTeX with Hebrew support)
\\usepackage{fontspec}
\\setmainfont{FreeSerif}[Ligatures=TeX]
\\setsansfont{FreeSans}
\\newfontfamily\\hebrewfont[Script=Hebrew, Scale=1.15]{FreeSerif}
\\newfontfamily\\hebrewfontsans[Script=Hebrew, Scale=1.1]{FreeSans}
\\newfontfamily\\hebrewfontlarge[Script=Hebrew, Scale=1.5]{FreeSerif}
\\newfontfamily\\hebrewfonttitle[Script=Hebrew, Scale=2.0]{FreeSerif}

%%% Hebrew / RTL support (native XeTeX bidi)
\\newenvironment{hebrew}{%
  \\par\\begingroup\\hebrewfont\\TeXXeTstate=1\\beginR\\parindent=0pt\\relax
}{%
  \\endR\\endgroup\\par
}
\\newcommand{\\texthebrew}[1]{{\\hebrewfont\\TeXXeTstate=1\\beginR #1\\endR}}

%%% Parallel columns for bilingual text
\\usepackage{paracol}
\\setcolumnwidth{0.48\\textwidth, 0.48\\textwidth}

%%% Colors
\\usepackage[dvipsnames]{xcolor}
\\definecolor{accent}{HTML}{1B3A5C}
\\definecolor{gold}{HTML}{C5962A}
\\definecolor{muted}{HTML}{6B7280}

%%% Graphics
\\usepackage{graphicx}
\\usepackage{tikz}

%%% Layout
\\usepackage{fancyhdr}
\\usepackage{titlesec}
\\usepackage{setspace}
\\usepackage{parskip}
\\usepackage{hyperref}

\\hypersetup{
  colorlinks=false,
  pdfborder={0 0 0},
}

%%% Headers & Footers
\\pagestyle{fancy}
\\fancyhf{}
\\renewcommand{\\headrulewidth}{0pt}
\\fancyfoot[C]{\\small\\thepage}

%%% Spacing
\\setlength{\\parskip}{6pt}
\\setlength{\\parindent}{0pt}

\\begin{document}

${pages}

\\end{document}
`
}
