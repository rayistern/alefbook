import { describe, it, expect } from 'vitest'
import {
  BOOK_TEMPLATES,
  getBookTemplate,
  listBookTemplates,
  listTemplateIds,
  getTemplatePageCount,
  getTemplateImageDirs,
  getTemplateSystemPrompt,
  isFixedPageTemplate,
  getSystemPrompt,
  HAGGADAH_SYSTEM_PROMPT,
  GENERIC_BOOKLET_SYSTEM_PROMPT,
  SEFER_SYSTEM_PROMPT,
} from '../registry'

// ── Registry shape & template #1 (the Haggadah) ──────────────────────────────

describe('book-template registry', () => {
  it('makes the Haggadah template #1 (registry order preserved)', () => {
    expect(BOOK_TEMPLATES[0].id).toBe('haggadah')
    expect(listBookTemplates()[0].id).toBe('haggadah')
  })

  it('extracts the Haggadah structure as data (15 seder steps + covers/toc)', () => {
    const haggadah = getBookTemplate('haggadah')!
    const sectionIds = haggadah.structure.map((s) => s.id)
    // Covers/title/toc present
    expect(sectionIds).toContain('cover')
    expect(sectionIds).toContain('toc')
    expect(sectionIds).toContain('back-cover')
    // All 15 seder steps present
    for (const step of [
      'kadesh', 'urchatz', 'karpas', 'yachatz', 'maggid', 'rachtzah',
      'motzi', 'matzah', 'maror', 'korech', 'shulchan-orech', 'tzafun',
      'barech', 'hallel', 'nirtzah',
    ]) {
      expect(sectionIds).toContain(step)
    }
  })

  it('marks the liturgical body immutable-by-construction (static-text architecture)', () => {
    const haggadah = getBookTemplate('haggadah')!
    const kadesh = haggadah.structure.find((s) => s.id === 'kadesh')!
    expect(kadesh.baseTextImmutable).toBe(true)
    // The liturgy module itself is not editable; only its image slot is.
    const liturgy = kadesh.modules.find((m) => m.type === 'seder-step-liturgy')!
    expect(liturgy.editable).toBe(false)
    const imageSlot = kadesh.modules.find((m) => m.type === 'image-slot')!
    expect(imageSlot.editable).toBe(true)
    // The cover, by contrast, is personalisable.
    const cover = haggadah.structure.find((s) => s.id === 'cover')!
    expect(cover.baseTextImmutable).toBe(false)
  })

  it('carries per-template LaTeX assets + fixed-page policy for the Haggadah', () => {
    const haggadah = getBookTemplate('haggadah')!
    expect(haggadah.asset).toEqual({ kind: 'file', path: 'templates/haggadah-latex/source.tex' })
    expect(haggadah.imageDirs).toContain('templates/haggadah-images')
    expect(haggadah.pagePolicy).toBe('fixed')
    expect(haggadah.fixedPageCount).toBe(52)
  })
})

// ── Template #2 proves generalisation ───────────────────────────────────────

describe('generalisation proof (template #2 — blessings-booklet)', () => {
  it('exists as a distinct registry row with its own file asset', () => {
    const t2 = getBookTemplate('blessings-booklet')
    expect(t2).toBeDefined()
    expect(t2!.asset).toEqual({
      kind: 'file',
      path: 'templates/blessings-booklet-latex/source.tex',
    })
    expect(listTemplateIds()).toContain('blessings-booklet')
  })

  it('differs from the Haggadah on every axis the registry generalises', () => {
    const hag = getBookTemplate('haggadah')!
    const t2 = getBookTemplate('blessings-booklet')!
    // Page policy: flowing vs fixed
    expect(t2.pagePolicy).toBe('flowing')
    expect(hag.pagePolicy).toBe('fixed')
    // Images: none vs the Haggadah's image dir (no forced inheritance)
    expect(t2.imageDirs).toEqual([])
    // Prompt: generic vs Chabad/Haggadah
    expect(t2.systemPromptId).toBe('generic-booklet')
    expect(hag.systemPromptId).toBe('haggadah')
    // Slots are FILLED by the designer (editable) — opposite end of the
    // static-text axis from the immutable liturgy.
    const blessing = t2.structure.find((s) => s.id === 'blessing-1')!
    expect(blessing.baseTextImmutable).toBe(false)
    expect(blessing.modules[0].editable).toBe(true)
  })
})

// ── Lookup helpers (the call-site replacements) ─────────────────────────────

describe('registry lookup helpers', () => {
  it('getTemplatePageCount: fixed books lock, flowing books honour the request', () => {
    // Fixed book ignores the requested count.
    expect(getTemplatePageCount('haggadah', 7)).toBe(52)
    expect(isFixedPageTemplate('haggadah')).toBe(true)
    // Flowing book honours the requested count, else its default.
    expect(getTemplatePageCount('blessings-booklet', 12)).toBe(12)
    expect(getTemplatePageCount('blessings-booklet')).toBe(8)
    expect(isFixedPageTemplate('blessings-booklet')).toBe(false)
    // Unknown id falls back gracefully.
    expect(getTemplatePageCount('does-not-exist', 5)).toBe(5)
    expect(getTemplatePageCount('does-not-exist')).toBe(10)
  })

  it('getTemplateImageDirs returns per-template dirs (empty for image-less books)', () => {
    expect(getTemplateImageDirs('haggadah')).toEqual(['templates/haggadah-images'])
    expect(getTemplateImageDirs('blessings-booklet')).toEqual([])
    expect(getTemplateImageDirs('unknown')).toEqual([])
  })

  it('getTemplateSystemPrompt selects the right per-template prompt', () => {
    expect(getTemplateSystemPrompt('haggadah')).toBe(HAGGADAH_SYSTEM_PROMPT)
    expect(getTemplateSystemPrompt('blessings-booklet')).toBe(GENERIC_BOOKLET_SYSTEM_PROMPT)
    // Unknown id falls back to the Haggadah prompt (preserves prior behaviour).
    expect(getTemplateSystemPrompt('unknown')).toBe(HAGGADAH_SYSTEM_PROMPT)
  })

  it('system prompts carry the shared LaTeX rules + the right product header', () => {
    // Shared mechanics appear in both.
    expect(HAGGADAH_SYSTEM_PROMPT).toContain('## search_replace rules')
    expect(GENERIC_BOOKLET_SYSTEM_PROMPT).toContain('## search_replace rules')
    // Chabad content policy only in the Haggadah prompt.
    expect(HAGGADAH_SYSTEM_PROMPT).toContain('Chabad')
    expect(GENERIC_BOOKLET_SYSTEM_PROMPT).not.toContain('Chabad')
    // The generic prompt forbids sourcing sacred text.
    expect(GENERIC_BOOKLET_SYSTEM_PROMPT).toContain('never source it yourself')
  })

  it('getSystemPrompt is a pure id→text resolver with a safe fallback', () => {
    expect(getSystemPrompt('haggadah')).toBe(HAGGADAH_SYSTEM_PROMPT)
    expect(getSystemPrompt('generic-booklet')).toBe(GENERIC_BOOKLET_SYSTEM_PROMPT)
    expect(getSystemPrompt('nope')).toBe(HAGGADAH_SYSTEM_PROMPT)
  })

  // ── The sefer template (Torah/seforim reframe, portfolio decision B5) ──────

  it('registers the sefer template as a flowing, generator-backed Hebrew book', () => {
    const sefer = getBookTemplate('sefer')!
    expect(sefer.intent).toBe('sefer')
    expect(sefer.pagePolicy).toBe('flowing')
    expect(sefer.asset).toEqual({ kind: 'generator', generator: 'sefer' })
    // Seforim trim, not the Haggadah's picture-book trim.
    expect(sefer.documentSetup.pageWidthIn).toBe(6)
    expect(sefer.documentSetup.pageHeightIn).toBe(9)
    // No images — must not drag the Haggadah's image dirs into a sefer build.
    expect(getTemplateImageDirs('sefer')).toEqual([])
    expect(isFixedPageTemplate('sefer')).toBe(false)
  })

  it('gives the sefer its authorship-specific system prompt', () => {
    expect(getTemplateSystemPrompt('sefer')).toBe(SEFER_SYSTEM_PROMPT)
    // Shared LaTeX mechanics still included.
    expect(SEFER_SYSTEM_PROMPT).toContain('## search_replace rules')
    // The authorship rule: quoted mekorot are verbatim-from-the-user only.
    expect(SEFER_SYSTEM_PROMPT).toContain('verbatim')
    // Flowing behaviour, not the Haggadah's fixed-page discipline.
    expect(SEFER_SYSTEM_PROMPT).toContain('flowing book')
  })

  it('every registry entry is internally consistent', () => {
    for (const t of BOOK_TEMPLATES) {
      expect(t.id).toBeTruthy()
      expect(t.format).toBe('latex')
      // Fixed books must declare their locked count.
      if (t.pagePolicy === 'fixed') expect(t.fixedPageCount).toBeGreaterThan(0)
      // File-backed assets must point somewhere; generators must name a generator.
      if (t.asset.kind === 'file') expect(t.asset.path).toContain('templates/')
      if (t.asset.kind === 'generator') expect(t.asset.generator).toBeTruthy()
    }
  })
})
