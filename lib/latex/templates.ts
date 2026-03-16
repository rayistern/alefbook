import { readFileSync } from 'fs'
import path from 'path'

export interface TemplateFiles {
  main: string
  preamble: string
  pages: Record<string, string>
}

export function getTemplate(templateId: string, pageCount: number): TemplateFiles {
  switch (templateId) {
    case 'haggadah':
      return haggadahTemplate()
    case 'hebrew-english':
      return hebrewEnglishTemplate(pageCount)
    case 'blank':
    default:
      return blankTemplate(pageCount)
  }
}

function blankTemplate(pageCount: number): TemplateFiles {
  const pages: Record<string, string> = {}

  for (let i = 1; i <= pageCount; i++) {
    const num = String(i).padStart(3, '0')
    if (i === 1) {
      pages[`page-${num}.tex`] = `% Page ${i} — Title Page
\\thispagestyle{empty}
\\begin{center}
\\vspace*{3cm}

{\\Huge\\bfseries My Book}

\\vspace{1cm}

{\\Large A new creation}

\\vspace{2cm}

{\\large Author Name}

\\vfill

{\\small Created with AlefBook}

\\end{center}
\\newpage
`
    } else {
      pages[`page-${num}.tex`] = `% Page ${i}
\\section*{Page ${i}}

Your content goes here. You can ask the AI to help you write and format this page.

\\newpage
`
    }
  }

  return {
    main: generateMainTex(pageCount),
    preamble: blankPreamble(),
    pages,
  }
}

function hebrewEnglishTemplate(pageCount: number): TemplateFiles {
  const pages: Record<string, string> = {}

  for (let i = 1; i <= pageCount; i++) {
    const num = String(i).padStart(3, '0')
    if (i === 1) {
      pages[`page-${num}.tex`] = `% Page ${i} — Title Page
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

{\\small Created with AlefBook}

\\end{center}
\\newpage
`
    } else if (i % 2 === 0) {
      pages[`page-${num}.tex`] = `% Page ${i} — Bilingual spread
\\begin{paracol}{2}
\\switchcolumn[0]

% English column (left)
\\section*{Chapter ${Math.floor(i / 2)}}

English text goes here. The AI can help you write content in both languages.

\\switchcolumn[1]

% Hebrew column (right)
\\begin{hebrew}
{\\Large פרק ${Math.floor(i / 2)}}

\\vspace{0.5em}

טקסט בעברית כאן. הבינה המלאכותית יכולה לעזור לכתוב תוכן בשתי השפות.
\\end{hebrew}

\\end{paracol}
\\newpage
`
    } else {
      pages[`page-${num}.tex`] = `% Page ${i}

Content for page ${i}.

\\newpage
`
    }
  }

  return {
    main: generateMainTex(pageCount),
    preamble: hebrewEnglishPreamble(),
    pages,
  }
}

/**
 * Haggadah template — reads the monolithic source.tex and splits it into
 * preamble + page files at each section marker (%%+ ---- SECTION ----).
 */
function haggadahTemplate(): TemplateFiles {
  const sourcePath = path.join(process.cwd(), 'templates/haggadah-latex/source.tex')
  const source = readFileSync(sourcePath, 'utf-8')
  const lines = source.split('\n')

  // Find key boundaries
  const docClassIdx = lines.findIndex(l => l.startsWith('\\documentclass'))
  const beginDocIdx = lines.findIndex(l => l.trim() === '\\begin{document}')
  const endDocIdx = lines.findIndex(l => l.trim() === '\\end{document}')

  // Preamble: everything between \documentclass and \begin{document}
  const preamble = lines.slice(docClassIdx + 1, beginDocIdx).join('\n').trim()

  // Body: between \begin{document} and \end{document}
  const bodyLines = lines.slice(beginDocIdx + 1, endDocIdx)

  // Split body at section markers (lines like: %%% ---- COVER PAGE ----)
  const sectionMarker = /^%%+\s+----/
  const pages: Record<string, string> = {}
  let current: string[] = []
  let pageNum = 0

  for (const line of bodyLines) {
    if (sectionMarker.test(line)) {
      // Save accumulated content as a page (if non-empty)
      const content = current.join('\n').trim()
      if (content) {
        pageNum++
        pages[`page-${String(pageNum).padStart(3, '0')}.tex`] = content
      }
      current = [line]
    } else {
      current.push(line)
    }
  }

  // Save last section
  const last = current.join('\n').trim()
  if (last) {
    pageNum++
    pages[`page-${String(pageNum).padStart(3, '0')}.tex`] = last
  }

  return {
    main: generateMainTex(pageNum),
    preamble,
    pages,
  }
}

function generateMainTex(pageCount: number): string {
  const pageInputs = Array.from({ length: pageCount }, (_, i) => {
    const num = String(i + 1).padStart(3, '0')
    return `\\input{pages/page-${num}}`
  }).join('\n')

  return `\\documentclass[11pt, openany]{book}

\\input{preamble}

\\begin{document}

${pageInputs}

\\end{document}
`
}

function blankPreamble(): string {
  return `%%% AlefBook Preamble — Blank Template

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
`
}

function hebrewEnglishPreamble(): string {
  return `%%% AlefBook Preamble — Hebrew-English Bilingual Template

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
`
}
