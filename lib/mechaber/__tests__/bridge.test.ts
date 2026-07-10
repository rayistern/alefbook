import { describe, it, expect } from 'vitest'
import {
  latexEscape,
  blockToLatex,
  mechaberRequestToLatex,
  type MechaberTypesetRequest,
} from '../bridge'

// ── LaTeX escaping — the safety layer for verbatim mechaber text ─────────────

describe('latexEscape', () => {
  it('escapes every LaTeX special character', () => {
    expect(latexEscape('50% & $5 #1 _x {y} ~z ^w')).toBe(
      '50\\% \\& \\$5 \\#1 \\_x \\{y\\} \\textasciitilde{}z \\textasciicircum{}w'
    )
  })

  it('escapes backslashes first (no double-escaping of its own output)', () => {
    expect(latexEscape('a\\b')).toBe('a\\textbackslash{}b')
    // The braces of \textbackslash{} must not themselves get escaped.
    expect(latexEscape('\\')).toBe('\\textbackslash{}')
  })

  it('passes Hebrew text through untouched (only ASCII specials are escaped)', () => {
    expect(latexEscape('בראשית ברא אלקים')).toBe('בראשית ברא אלקים')
  })
})

// ── Per-block rendering ──────────────────────────────────────────────────────

describe('blockToLatex', () => {
  it('maps heading levels to starred sectioning commands', () => {
    expect(blockToLatex({ type: 'heading', level: 1, text: 'Intro' })).toBe('\\section*{Intro}')
    expect(blockToLatex({ type: 'heading', level: 2, text: 'Part' })).toBe('\\subsection*{Part}')
    expect(blockToLatex({ type: 'heading', level: 3, text: 'Sub' })).toBe('\\subsubsection*{Sub}')
  })

  it('wraps Hebrew headings and paragraphs in RTL machinery', () => {
    expect(blockToLatex({ type: 'heading', level: 1, text: 'פרק א', lang: 'he' })).toBe(
      '\\section*{\\texthebrew{פרק א}}'
    )
    const heb = blockToLatex({ type: 'paragraph', text: 'שלום', lang: 'he' })
    expect(heb).toContain('\\begin{hebrew}')
    expect(heb).toContain('שלום')
    expect(heb).toContain('\\end{hebrew}')
  })

  it('renders a mekor verbatim: citation + Hebrew RTL + divider + translation', () => {
    const out = blockToLatex({
      type: 'source',
      citation: 'Bereishis 1:1',
      he: 'בראשית ברא',
      en: 'In the beginning',
    })
    expect(out).toContain('\\begin{mekor}{Bereishis 1:1}')
    expect(out).toContain('בראשית ברא')
    expect(out).toContain('\\mekordivider')
    expect(out).toContain('In the beginning')
    expect(out).toContain('\\end{mekor}')
  })

  it('omits the divider when a mekor has only one language', () => {
    const out = blockToLatex({ type: 'source', citation: 'Tehillim 23', he: 'מזמור לדוד' })
    expect(out).not.toContain('\\mekordivider')
  })

  it('renders callouts with an optional bolded title', () => {
    expect(blockToLatex({ type: 'callout', title: 'Discuss', text: 'Why?' })).toContain(
      '\\begin{callout}[Discuss]'
    )
    expect(blockToLatex({ type: 'callout', text: 'Note' })).toContain('\\begin{callout}\n')
  })

  it('renders page breaks', () => {
    expect(blockToLatex({ type: 'page-break' })).toBe('\\newpage')
  })
})

// ── Whole-document conversion (the seam contract) ────────────────────────────

const REQUEST: MechaberTypesetRequest = {
  version: 1,
  artifact: {
    id: 'mech-123',
    family: 'flow-doc',
    title: 'Sources on Bitachon',
    titleHe: 'מקורות בעניני בטחון',
    author: 'R. Ploni Almoni',
  },
  documentSetup: { pageWidthIn: 8.5, pageHeightIn: 11 },
  blocks: [
    { type: 'heading', level: 1, text: 'Bitachon vs. Emunah' },
    { type: 'source', citation: 'Chovos HaLevavos, Sha\'ar HaBitachon', he: 'מהות הבטחון' },
    { type: 'callout', title: 'Discuss', text: 'How do these differ?' },
  ],
}

describe('mechaberRequestToLatex', () => {
  it('produces a complete XeLaTeX document with title page, setup, and body', () => {
    const { main } = mechaberRequestToLatex(REQUEST)
    expect(main).toContain('\\documentclass')
    // documentSetup drives geometry (the print-grade knob mechaber lacks).
    expect(main).toContain('paperwidth=8.5in')
    expect(main).toContain('paperheight=11in')
    // Title page carries both titles + author.
    expect(main).toContain('Sources on Bitachon')
    expect(main).toContain('מקורות בעניני בטחון')
    expect(main).toContain('R. Ploni Almoni')
    // Body blocks all present, in order.
    const iHeading = main.indexOf('Bitachon vs. Emunah')
    const iSource = main.indexOf('מהות הבטחון')
    const iCallout = main.indexOf('How do these differ?')
    expect(iHeading).toBeGreaterThan(-1)
    expect(iSource).toBeGreaterThan(iHeading)
    expect(iCallout).toBeGreaterThan(iSource)
    expect(main).toContain('\\end{document}')
  })

  it('defaults to the 7×10in house trim when no documentSetup is sent', () => {
    const { main } = mechaberRequestToLatex({ ...REQUEST, documentSetup: undefined })
    expect(main).toContain('paperwidth=7in')
    expect(main).toContain('paperheight=10in')
  })

  it('rejects unknown contract versions loudly (no silent mis-typesetting)', () => {
    expect(() =>
      mechaberRequestToLatex({ ...REQUEST, version: 2 as unknown as 1 })
    ).toThrow(/version/i)
  })

  it('rejects non-flow-document families (v1 has no god-IR)', () => {
    expect(() =>
      mechaberRequestToLatex({
        ...REQUEST,
        artifact: { ...REQUEST.artifact, family: 'design-canvas' as unknown as 'flow-doc' },
      })
    ).toThrow(/family/i)
  })
})
