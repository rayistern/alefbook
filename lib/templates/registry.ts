/**
 * Data-driven book-template registry — the single source of truth for every
 * product the designer can create. This closes go-live blocker issue #14
 * ("Generalize the product layer beyond the Haggadah"): before this file, a
 * new book required a code change in ~4 places (a `switch` in
 * `lib/latex/templates.ts`, a `TEMPLATES` array in the admin compile route,
 * a `templatePageCounts` map in the project route, template cards in
 * `app/project/new/page.tsx`) plus a hardcoded system prompt and TEXINPUTS
 * image dirs. Now every one of those reads this registry, so adding a book is
 * a data row here (plus its LaTeX asset), not a code edit + redeploy.
 *
 * ─── Why this shape ────────────────────────────────────────────────────────
 * The data model is ported from merkos-302/mechaber's `studio/artifactTypes.ts`
 * + `artifactTemplates.ts` `ArtifactTemplate[]` registry (see the ALEF1 recon,
 * batches/audits/alefbook-shopify-mechaber-recon-2026-07-06.md). We adopt
 * mechaber's *data model* — a template = metadata + a declared structure of
 * sections/modules/slots + a `documentSetup` — but NOT mechaber's HTML/BlockNote
 * renderer. alefbook keeps its XeLaTeX → PDF backend (its print-grade moat), so
 * each template here points at a LaTeX asset (a `source.tex` file or a procedural
 * generator) instead of mechaber's HTML modules.
 *
 * ─── Static-text architecture (Rayi's constraint) ─────────────────────────
 * Liturgical books (the Haggadah) have a fixed base text that must be immutable
 * *by construction* — the designer personalises the wrapper (cover, colours,
 * a Chabad-house name, added images), never the sacred body. That invariant is
 * encoded per-section as `baseTextImmutable` and per-module as `editable`, so
 * downstream tooling (the AI orchestrator, a future canvas) can enforce it
 * rather than relying on prompt discipline alone.
 *
 * This module is PURE DATA — no `fs`, no Node-only imports — so it is safe to
 * import from client components (e.g. the new-project page) as well as server
 * code. Anything that reads a file from disk (the actual `source.tex` bytes,
 * enumerating image files) lives in `lib/latex/templates.ts`, driven by the
 * asset descriptors declared here.
 */

// ─── Structure vocabulary ────────────────────────────────────────────────────

/**
 * How a book's page count behaves under edits. The Haggadah is `fixed`: it is a
 * designed, page-locked artifact, so the orchestrator's overflow guard reverts
 * any edit that changes the page count (issue #14's "overflow heuristic assumes
 * fixed-page books"). A `flowing` book (a notebook, a blessings booklet) grows
 * naturally as content is added, so that guard must NOT fire. Making this a
 * per-template policy is exactly the generalisation #14 asks for.
 */
export type PagePolicy = 'fixed' | 'flowing'

/** How the LaTeX for a template is obtained at project-creation time. */
export type TemplateAssetSource =
  | {
      /** A complete, pre-authored `source.tex` read from disk (e.g. the Haggadah). */
      kind: 'file'
      /** Path relative to `process.cwd()`, e.g. "templates/haggadah-latex/source.tex". */
      path: string
    }
  | {
      /**
       * A procedural document built by a named generator in
       * `lib/latex/templates.ts` (e.g. the `blank` and `hebrew-english`
       * scaffolds, which are parameterised by page count). Kept out of this
       * pure-data module so the registry stays client-importable.
       */
      kind: 'generator'
      generator: string
    }

/**
 * One editable region inside a module — a "slot" in mechaber's vocabulary. A
 * slot is where personalisation happens (a cover title, a Chabad-house name,
 * an image). Base liturgical text is deliberately NOT modelled as a slot; it is
 * part of the immutable body.
 */
export interface TemplateSlot {
  id: string
  /** Human label shown in tooling. */
  label: string
  kind: 'text' | 'image' | 'color' | 'richtext'
  /** Whether the designer/AI may write to this slot. */
  editable: boolean
}

/**
 * A reusable content block inside a section — mirrors mechaber's `modules/`
 * concept (`source-chunk`, `callout-box`, …), but for LaTeX books the module is
 * a description of a structural block rather than a React component. Modules
 * declare their slots and whether their body is editable.
 */
export interface TemplateModule {
  /** Module type id (e.g. "seder-step", "hebrew-block", "image-slot"). */
  type: string
  label: string
  /** If false, the module's body is part of the immutable base text. */
  editable: boolean
  slots?: TemplateSlot[]
}

/**
 * A top-level structural unit of the book (a cover, the table of contents, a
 * seder step). Extracted from the Haggadah's `%%% ---- … ----` section markers
 * so the book's structure lives as data, per issue #14.
 */
export interface TemplateSection {
  id: string
  label: string
  /**
   * When true, the section's base text is fixed by construction and must never
   * be rewritten by the designer/AI — only its editable slots/modules change.
   * This is the static-text invariant.
   */
  baseTextImmutable: boolean
  modules: TemplateModule[]
}

/**
 * Print/document setup — the LaTeX analogue of mechaber's `documentSetup`
 * (`frontend/src/studio/documentSetup.ts`). Values are print-oriented (inches,
 * trim) because the output is a sellable, physically-printed book.
 */
export interface TemplateDocumentSetup {
  pageWidthIn: number
  pageHeightIn: number
  bleedIn: number
  binding: 'perfect' | 'saddle-stitch' | 'none'
  languages: string[]
}

/**
 * Which branding strings a deployment injects at runtime, and their env keys.
 * Issue #14: "Shluchim Exchange" is hardcoded across the app; an alefbook.org
 * deployment needs env-driven branding. The registry records the *default*
 * (back-compat: unchanged for the existing deployment) and the env key that
 * overrides it, without this pure-data module reading `process.env` itself.
 */
export interface TemplateBranding {
  /** Default brand name if the env var is unset (preserves current behaviour). */
  defaultBrandName: string
  /** Env var that overrides the brand name (e.g. NEXT_PUBLIC_BRAND_NAME). */
  brandNameEnvKey: string
}

/**
 * A full book product. This is the LaTeX-backed sibling of mechaber's
 * `ArtifactTemplate`.
 */
export interface BookTemplate {
  /** Stable id used everywhere (DB `projects.template_id`, storage paths, URLs). */
  id: string
  name: string
  description: string
  /** Emoji shown on the template card (UI only). */
  icon: string
  /** Tailwind gradient classes for the card (UI only). */
  cardGradient: string
  /** All current products render via XeLaTeX; kept explicit for future formats. */
  format: 'latex'
  /** Product intent — mirrors mechaber's `intent`; drives grouping/UX later. */
  intent: 'haggadah' | 'liturgy' | 'general'
  pagePolicy: PagePolicy
  /** Default page count for `flowing` books / the create slider. */
  defaultPageCount: number
  /** For `fixed` books, the locked page count (the overflow guard's target). */
  fixedPageCount?: number
  /** How to obtain the LaTeX at creation time. */
  asset: TemplateAssetSource
  /**
   * Image directories (relative to cwd) added to TEXINPUTS when compiling this
   * template. Replaces the compiler's hardcoded haggadah dirs — a template with
   * no images (`[]`) no longer drags the Haggadah's image path into its build.
   */
  imageDirs: string[]
  documentSetup: TemplateDocumentSetup
  branding: TemplateBranding
  /**
   * Id of the AI system prompt this template uses (resolved via
   * `getSystemPrompt`). Extracted from `lib/ai/orchestrator.ts`, where it was a
   * single hardcoded Haggadah-specific `SYSTEM_PROMPT` const (issue #14).
   */
  systemPromptId: string
  /** The book's structure, extracted as data (issue #14). */
  structure: TemplateSection[]
}

// ─── System prompts (extracted from the orchestrator) ────────────────────────

/**
 * Product-neutral LaTeX/tool mechanics, extracted verbatim from the original
 * hardcoded `SYSTEM_PROMPT` in `lib/ai/orchestrator.ts`. These rules (colour
 * syntax, search_replace discipline, scope, overflow, image processing, file
 * uploads, undo, conversation history) are identical for every book, so they
 * live once and every template's prompt appends them.
 *
 * The product-SPECIFIC header (brand, content policy, per-product image
 * guidance) is what varies per template — see HAGGADAH_HEADER / GENERIC_HEADER.
 * Composing header + shared rules is how the single hardcoded prompt becomes
 * per-template data, closing that part of issue #14.
 */
export const SHARED_TOOL_RULES = `## When to use tools
- For text/layout/color changes: use the search_replace tool
- For creating new images/illustrations: use generate_image, then search_replace to insert it
- For questions or chat: just respond directly (no tools needed)

## LaTeX color syntax — CRITICAL
- NEVER use CSS-style hex colors like \`#2ec993\` in LaTeX. The \`#\` character is invalid in xcolor/TikZ color values and will cause compilation errors.
- NEVER use inline HTML color syntax like \`\\\\fill[fill={HTML}{2EC993}]\` or \`\\\\color[HTML]{2EC993}\` inside TikZ environments, especially inside shipout overlays (\`\\\\AddToShipoutPictureBG\`) or \`remember picture, overlay\` blocks. Inline HTML color specs fail in these contexts and cause compilation errors.
- **ALWAYS define a named color first, then reference it by name.** This is the ONLY reliable approach for TikZ fills and draws:
  1. Add \`\\\\definecolor{mycolor}{HTML}{2EC993}\` in the preamble (near the other \\\\definecolor lines)
  2. Then use the named color: \`\\\\fill[fill=mycolor] ...\`
- For simple text coloring outside TikZ, \`\\\\textcolor[HTML]{2EC993}{text}\` is acceptable.
- If the document already defines named colors (e.g. \`sederblue\`, \`sedergold\`), prefer defining a new named color or redefining the existing one.
- When changing a color, this requires TWO search_replace calls: one to add/modify the \\\\definecolor in the preamble, and one to update the color name reference on the target page.

## search_replace rules
- The search text must be an EXACT substring that appears EXACTLY ONCE in the document.
- Include 5+ lines of surrounding context to ensure uniqueness — more context is always better.
- CRITICAL: The document has section markers like \`%%% ---- COVER PAGE ----\` and \`%%% ---- BACK COVER ----\`. The front and back covers have VERY similar content. ALWAYS include the nearest section marker in your search text. "Cover" or "front cover" = \`%%% ---- COVER PAGE ----\`, NOT the back cover.
- **ONLY change what was requested.** Your replacement text must be IDENTICAL to the search text except for the specific thing being changed. Do NOT modify, rename, remove, or replace \\\\includegraphics commands, image filenames, or any other content that the user did NOT ask you to change. If an \\\\includegraphics line appears in your search context, copy it EXACTLY into the replacement.
- You can call search_replace multiple times for multiple changes.
- Hebrew text is RTL — careful with \\\\beginR, \\\\endR, \\\\texthebrew{}.
- Do not remove \\\\usepackage declarations unless explicitly asked.
- Do NOT reference image filenames that are not already in the document or provided via [Uploaded:] or generate_image. Never invent filenames like "chabad-logo.png" — only use images that exist.

## SCOPE DISCIPLINE — CRITICAL
- ONLY edit the specific page/section the user asked about. If the user says "front cover", ONLY touch content between \`%%% ---- COVER PAGE ----\` and the next \`\\\\clearpage\`.
- NEVER touch other sections "while you're at it" or to "improve" the document.
- Each search_replace call should target ONE section. Your search text must start with or contain the section marker of the page you're editing.
- If you need to make room on a page, only remove/shrink elements ON THAT SAME PAGE. Never modify other pages to compensate.
- After all edits, the ONLY difference between the old and new document should be within the requested section(s). Everything else must be byte-for-byte identical.

## Page overflow awareness — CRITICAL
The document uses a 7×10in page with ~8.2in of usable vertical space. Content MUST NOT spill across page boundaries.

**Space budget — know these approximate sizes:**
- \\\\includegraphics[width=3in]{...} → typically ~3in tall + 20pt padding ≈ 3.3in
- \\\\includegraphics[width=2in]{...} → typically ~2in tall + 20pt padding ≈ 2.3in
- \\\\pgfornament[width=3cm]{...} → ~0.5in tall
- \\\\vspace{Xin} → exactly X inches
- \\\\vspace{Xpt} → X/72 inches
- A TikZ decorative rule/divider → ~0.3–0.5in
- \\\\sedersection{...} header block → ~2in
- \\\\sederdivider → ~0.8in
- A text paragraph → ~0.3–0.5in per paragraph

**When adding ANY element, you MUST make room FIRST:**
1. Identify the page/section you're editing (between its \\\\clearpage or \\\\newpage boundaries)
2. Calculate how much vertical space the new element needs
3. BEFORE inserting, remove or shrink elements on that SAME page to free up at LEAST that much space
4. Only THEN insert the new element

**What to remove/shrink (in order of priority):**
1. \\\\vspace commands — reduce or eliminate them first
2. \\\\pgfornament, decorative TikZ drawings, \\\\bigstar nodes, ornamental dividers
3. Decorative border/frame TikZ code
4. \\\\sederdivider commands
5. Blank lines between elements
6. Font sizes (use \\\\small or \\\\footnotesize to shrink text)
You have FULL PERMISSION to remove ANY decorative element on ANY page. Preserving layout is ALWAYS more important than decorations.

**Hard rules:**
- ALWAYS use a size parameter on \\\\includegraphics: [width=2in] or [width=0.4\\\\textwidth]. Start SMALL (2in) — you can always make it bigger later, but overflow is much harder to fix.
- NEVER allow content to spill onto the next page. If in doubt, remove MORE space than you think you need.
- When inserting between existing elements, you are REPLACING vertical space, not adding to it.
- After making your edits, mentally walk through the page top-to-bottom and estimate total height. If it exceeds ~8in, shrink more.

## generate_image rules
- NEVER use TikZ, pgfplots, or LaTeX drawing commands for illustrations.
- Always use the generate_image tool, then insert with \\\\includegraphics via search_replace.
- Write a detailed, specific prompt describing ONLY the image scene — do NOT include instructions about the document or layout in the image prompt.

## Image processing rules

### imagemagick tool (PREFERRED for any image manipulation)
- Use the **imagemagick** tool to run arbitrary ImageMagick \`convert\` operations on images.
- You write the raw ImageMagick arguments yourself — you have full creative control.
- The tool takes a filename and an array of argument strings that go between the input and output paths.
- Example: to feather edges very slightly: \`["-alpha", "set", "-vignette", "0x3"]\`
- Example: to add a soft 2px Gaussian blur to edges only: \`["-alpha", "set", "(", "+clone", "-channel", "A", "-morphology", "Erode", "Disk:2", "+channel", ")", "-compose", "DstIn", "-composite"]\`
- Example: to convert to grayscale: \`["-colorspace", "Gray"]\`
- Example: to resize to 400px wide: \`["-resize", "400x"]\`
- You can compose ANY valid ImageMagick convert arguments. Use your knowledge of ImageMagick to craft the exact command needed.
- The processed image is saved as a NEW file — update the \\includegraphics reference via search_replace.
- Do NOT process images unless the user asks or it would clearly improve the result.

### process_image tool (LEGACY — simple presets only)
- Use process_image only for simple preset operations (feather, trim, resize, grayscale, sepia, etc.).
- For anything that needs fine control or custom parameters, use the **imagemagick** tool instead.

## File uploads
- \`[Uploaded: filename.png]\` → use exactly: \\\\includegraphics{images/filename.png}
- \`[File: name.txt]...[/File]\` → text file content between the tags

## Undo
- If you realize your edits broke the layout, caused overflow, or modified the wrong sections, call undo_all_changes immediately rather than trying to patch broken edits.
- It's better to undo and start fresh than to make the document worse with attempted fixes.
- If the user says "undo" or "revert", call undo_all_changes.

## Conversation history
- Use chat history to understand follow-up requests like "try again" or "undo that".
- Previous assistant messages may contain \`[Changes applied: ...]\` tags that describe exactly what was changed (generated images, edits made). Use this to know which files exist and what was done before. NEVER overwrite or rename files mentioned in prior changes unless the user explicitly asks.`

/**
 * The Haggadah/Chabad product header. Carries everything Haggadah-specific from
 * the original prompt: the Chabad audience/content policy, the static-text
 * (immutable liturgy) invariant, and the Jewish-imagery guidance that used to
 * sit inside the generate_image section. Composed with SHARED_TOOL_RULES to
 * form the full prompt.
 *
 * NOTE: this is a restructure of the original single prompt (Chabad content
 * rules gathered into the header; shared LaTeX mechanics factored out), not a
 * byte-identical copy. No test asserts prompt text and nothing here is deployed
 * (deploys are held) — verify edit quality on the Haggadah before any go-live.
 */
const HAGGADAH_HEADER = `You are Shluchim Exchange's AI assistant for a Hebrew/English Haggadah book creation platform.

## Context — Chabad Jewish audience
This platform serves Chabad-Lubavitch shluchim (emissaries) and their communities. All content MUST be appropriate for an Orthodox Jewish / Chabad audience:
- The Haggadah is a Jewish Passover text. All imagery and content must reflect Jewish tradition.
- When generating images of people, they should be Jewish (e.g., families at a Seder table, children asking the Four Questions, rabbis, etc.). NEVER generate images of people from other religions or cultures unless specifically requested.
- Use Chabad-appropriate terminology: "Hashem" (not "God"), "Pesach" (not "Passover" in Hebrew contexts), "matzah" (not "bread"), etc.
- Respect halacha: no images mixing meat and dairy, no inappropriate imagery, etc.

## Static text — the liturgical body is immutable by construction
The base Haggadah text (Hebrew liturgy + its translation) is fixed. You personalise the WRAPPER — cover, colours, a Chabad-house name, added illustrations — never the sacred body text. Do not rewrite, paraphrase, reorder, or "improve" the liturgy.

## Jewish/Haggadah image guidance
When an image is for a Jewish/Haggadah context, incorporate these details naturally into your generate_image prompt where relevant:
- Matzah should be ROUND hand-made shmurah matzah (never square machine matzah)
- Maror is romaine lettuce or horseradish (NOT parsley — parsley is karpas, a different item)
- Boys/men should wear a yarmulke (kippah) and tzitzit
- Girls/women should wear modest clothing (skirts, not pants)
- Style should be warm and family-friendly
Do NOT dump all these guidelines into every prompt — only include what's relevant to the specific image being generated.

You help users edit their LaTeX documents, generate images, and answer questions.`

/**
 * A neutral product header for any non-liturgical flowing book (template #2 and
 * future general books). No Chabad content rules, no fixed-page assumption, and
 * an explicit "fill slots, never source sacred text yourself" instruction —
 * proving the prompt is now per-template data, not a Haggadah monolith.
 */
const GENERIC_HEADER = `You are an AI assistant for a LaTeX book-design platform. You help users design and typeset a book by editing its LaTeX source, generating images, and answering questions.

## Slots, not sourced text
This template is a scaffold with clearly-marked editable slots. Fill and edit the slots the user asks about; do NOT invent sacred, liturgical, or religious text. If the user wants specific liturgical or quoted content, ask them to provide the exact text — never source it yourself.

## Page behaviour
This is a flowing book: adding content may add pages, and that is fine. Do not force content to fit a fixed page count.`

/** Full Haggadah prompt = Chabad header + shared LaTeX/tool mechanics. */
export const HAGGADAH_SYSTEM_PROMPT = `${HAGGADAH_HEADER}\n\n${SHARED_TOOL_RULES}`

/** Full generic-booklet prompt = neutral header + shared LaTeX/tool mechanics. */
export const GENERIC_BOOKLET_SYSTEM_PROMPT = `${GENERIC_HEADER}\n\n${SHARED_TOOL_RULES}`

const SYSTEM_PROMPTS: Record<string, string> = {
  haggadah: HAGGADAH_SYSTEM_PROMPT,
  'generic-booklet': GENERIC_BOOKLET_SYSTEM_PROMPT,
}

/** Resolve a template's system prompt, falling back to the Haggadah prompt so
 * existing behaviour is preserved if an id is somehow unknown. */
export function getSystemPrompt(systemPromptId: string): string {
  return SYSTEM_PROMPTS[systemPromptId] ?? HAGGADAH_SYSTEM_PROMPT
}

// ─── The 15 steps of the Seder, as data ─────────────────────────────────────
// Extracted from the Haggadah's table-of-contents / `\sedersection` structure.
// Each becomes an immutable-base-text section whose only editable surface is an
// optional illustration slot (the designer may add a picture to a step, never
// change its liturgy).
const SEDER_STEPS: { id: string; label: string }[] = [
  { id: 'kadesh', label: 'Kadesh — Kiddush' },
  { id: 'urchatz', label: 'Urchatz — Washing' },
  { id: 'karpas', label: 'Karpas — Vegetable' },
  { id: 'yachatz', label: 'Yachatz — Breaking the Matzah' },
  { id: 'maggid', label: 'Maggid — Telling the Story' },
  { id: 'rachtzah', label: 'Rachtzah — Washing before the Meal' },
  { id: 'motzi', label: 'Motzi — Blessing over Bread' },
  { id: 'matzah', label: 'Matzah — Blessing over Matzah' },
  { id: 'maror', label: 'Maror — Bitter Herbs' },
  { id: 'korech', label: 'Korech — The Sandwich' },
  { id: 'shulchan-orech', label: 'Shulchan Orech — The Meal' },
  { id: 'tzafun', label: 'Tzafun — The Afikoman' },
  { id: 'barech', label: 'Barech — Grace after Meals' },
  { id: 'hallel', label: 'Hallel — Praise' },
  { id: 'nirtzah', label: 'Nirtzah — Conclusion' },
]

/** A seder step as an immutable-base-text section with a single optional image slot. */
function sederStepSection(step: { id: string; label: string }): TemplateSection {
  return {
    id: step.id,
    label: step.label,
    baseTextImmutable: true, // liturgy is fixed by construction
    modules: [
      { type: 'seder-step-liturgy', label: 'Liturgy (Hebrew + English)', editable: false },
      {
        type: 'image-slot',
        label: 'Optional illustration',
        editable: true,
        slots: [{ id: `${step.id}-image`, label: 'Illustration', kind: 'image', editable: true }],
      },
    ],
  }
}

// ─── The registry ────────────────────────────────────────────────────────────

export const BOOK_TEMPLATES: BookTemplate[] = [
  // ── Template #1 — the Haggadah (the existing hardcoded product, now data) ──
  {
    id: 'haggadah',
    name: 'Passover Haggadah',
    description:
      'Complete Haggadah Shel Pesach with Hebrew/English bilingual text, decorative ornaments, and all 15 seder steps.',
    icon: '🍷',
    cardGradient: 'from-amber-600 to-red-700',
    format: 'latex',
    intent: 'haggadah',
    pagePolicy: 'fixed',
    defaultPageCount: 52,
    fixedPageCount: 52,
    asset: { kind: 'file', path: 'templates/haggadah-latex/source.tex' },
    imageDirs: ['templates/haggadah-images'],
    documentSetup: {
      pageWidthIn: 7,
      pageHeightIn: 10,
      bleedIn: 0.125,
      binding: 'perfect',
      languages: ['he', 'en'],
    },
    branding: { defaultBrandName: 'Shluchim Exchange', brandNameEnvKey: 'NEXT_PUBLIC_BRAND_NAME' },
    systemPromptId: 'haggadah',
    structure: [
      { id: 'cover', label: 'Front Cover', baseTextImmutable: false, modules: [
        { type: 'cover', label: 'Cover', editable: true, slots: [
          { id: 'cover-title', label: 'Title', kind: 'text', editable: true },
          { id: 'cover-house', label: 'Chabad house name', kind: 'text', editable: true },
          { id: 'cover-accent', label: 'Accent colour', kind: 'color', editable: true },
        ] },
      ] },
      { id: 'title-page', label: 'Title Page', baseTextImmutable: false, modules: [
        { type: 'title', label: 'Title page', editable: true },
      ] },
      { id: 'toc', label: 'Table of Contents — The 15 Steps', baseTextImmutable: true, modules: [
        { type: 'toc', label: 'Contents', editable: false },
      ] },
      // The liturgical body: 15 immutable seder steps.
      ...SEDER_STEPS.map(sederStepSection),
      { id: 'back-cover', label: 'Back Cover', baseTextImmutable: false, modules: [
        { type: 'cover', label: 'Back cover', editable: true, slots: [
          { id: 'back-house', label: 'Chabad house name', kind: 'text', editable: true },
        ] },
      ] },
    ],
  },

  // ── The children's Haggadah — same body, kid styling (already existed) ──
  {
    id: 'haggadah-kids',
    name: "Children's Haggadah",
    description:
      "Kid-friendly Passover Haggadah with cartoon illustrations, playful fonts, and bright colors. Same complete text as the adult version.",
    icon: '🌟',
    cardGradient: 'from-orange-400 to-purple-500',
    format: 'latex',
    intent: 'haggadah',
    pagePolicy: 'fixed',
    defaultPageCount: 52,
    fixedPageCount: 52,
    asset: { kind: 'file', path: 'templates/haggadah-kids-latex/source.tex' },
    imageDirs: ['templates/haggadah-kids-images', 'templates/haggadah-images'],
    documentSetup: {
      pageWidthIn: 7,
      pageHeightIn: 10,
      bleedIn: 0.125,
      binding: 'perfect',
      languages: ['he', 'en'],
    },
    branding: { defaultBrandName: 'Shluchim Exchange', brandNameEnvKey: 'NEXT_PUBLIC_BRAND_NAME' },
    systemPromptId: 'haggadah',
    // Same structure as the adult Haggadah (shared body); reuse the seder steps.
    structure: [
      { id: 'cover', label: 'Front Cover', baseTextImmutable: false, modules: [
        { type: 'cover', label: 'Cover', editable: true },
      ] },
      ...SEDER_STEPS.map(sederStepSection),
    ],
  },

  // ── The procedural bilingual scaffold (already existed) ──
  {
    id: 'hebrew-english',
    name: 'Hebrew-English Bilingual',
    description:
      'Side-by-side bilingual layout with built-in Hebrew support and right-to-left formatting.',
    icon: '📖',
    cardGradient: 'from-purple-500 to-pink-500',
    format: 'latex',
    intent: 'general',
    pagePolicy: 'flowing',
    defaultPageCount: 10,
    asset: { kind: 'generator', generator: 'hebrew-english' },
    imageDirs: [],
    documentSetup: {
      pageWidthIn: 7,
      pageHeightIn: 10,
      bleedIn: 0,
      binding: 'perfect',
      languages: ['he', 'en'],
    },
    branding: { defaultBrandName: 'Shluchim Exchange', brandNameEnvKey: 'NEXT_PUBLIC_BRAND_NAME' },
    systemPromptId: 'generic-booklet',
    structure: [
      { id: 'title-page', label: 'Title Page', baseTextImmutable: false, modules: [
        { type: 'title', label: 'Title page', editable: true },
      ] },
      { id: 'body', label: 'Body', baseTextImmutable: false, modules: [
        { type: 'bilingual-spread', label: 'Bilingual spread', editable: true },
      ] },
    ],
  },

  // ── The blank scaffold (already existed) ──
  {
    id: 'blank',
    name: 'Blank Book',
    description: 'Start fresh with a clean layout. Perfect for any book project.',
    icon: '📄',
    cardGradient: 'from-blue-500 to-cyan-500',
    format: 'latex',
    intent: 'general',
    pagePolicy: 'flowing',
    defaultPageCount: 10,
    asset: { kind: 'generator', generator: 'blank' },
    imageDirs: [],
    documentSetup: {
      pageWidthIn: 7,
      pageHeightIn: 10,
      bleedIn: 0,
      binding: 'perfect',
      languages: ['en'],
    },
    branding: { defaultBrandName: 'Shluchim Exchange', brandNameEnvKey: 'NEXT_PUBLIC_BRAND_NAME' },
    systemPromptId: 'generic-booklet',
    structure: [
      { id: 'title-page', label: 'Title Page', baseTextImmutable: false, modules: [
        { type: 'title', label: 'Title page', editable: true },
      ] },
      { id: 'body', label: 'Body', baseTextImmutable: false, modules: [
        { type: 'page', label: 'Content page', editable: true },
      ] },
    ],
  },

  // ── Template #2 — the generalisation proof: a flowing Blessings Booklet ──
  // Deliberately UNLIKE the Haggadah on every axis the registry generalises:
  //   • pagePolicy: 'flowing' (Haggadah is 'fixed')
  //   • asset: its own self-contained source.tex (proves the file-asset path
  //     for a brand-new book, added with ZERO call-site code changes)
  //   • imageDirs: [] (proves a template need not inherit the Haggadah's images)
  //   • baseTextImmutable: false on the blessing sections — the designer FILLS
  //     the slots (the opposite end of the static-text axis from the Haggadah)
  //   • systemPromptId: 'generic-booklet' (no Chabad/Haggadah content rules)
  // CONTENT NOTE: the source ships PLACEHOLDER slots, not sourced liturgy. Real
  // blessing text is a content decision for the product owner; the POC proves
  // the mechanics without autonomously publishing sacred text. See
  // docs/TEMPLATE_REGISTRY.md.
  {
    id: 'blessings-booklet',
    name: 'Blessings Booklet',
    description:
      'A simple flowing bilingual booklet scaffold with editable slots for blessings and readings. Fill each slot with your own text.',
    icon: '🕯️',
    cardGradient: 'from-teal-500 to-emerald-600',
    format: 'latex',
    intent: 'liturgy',
    pagePolicy: 'flowing',
    defaultPageCount: 8,
    asset: { kind: 'file', path: 'templates/blessings-booklet-latex/source.tex' },
    imageDirs: [],
    documentSetup: {
      pageWidthIn: 5.5,
      pageHeightIn: 8.5,
      bleedIn: 0,
      binding: 'saddle-stitch',
      languages: ['he', 'en'],
    },
    branding: { defaultBrandName: 'Shluchim Exchange', brandNameEnvKey: 'NEXT_PUBLIC_BRAND_NAME' },
    systemPromptId: 'generic-booklet',
    structure: [
      { id: 'cover', label: 'Cover', baseTextImmutable: false, modules: [
        { type: 'cover', label: 'Cover', editable: true, slots: [
          { id: 'cover-title', label: 'Booklet title', kind: 'text', editable: true },
        ] },
      ] },
      { id: 'blessing-1', label: 'Blessing 1', baseTextImmutable: false, modules: [
        { type: 'blessing-slot', label: 'Blessing', editable: true, slots: [
          { id: 'blessing-1-he', label: 'Hebrew text', kind: 'text', editable: true },
          { id: 'blessing-1-en', label: 'English text', kind: 'text', editable: true },
        ] },
      ] },
      { id: 'blessing-2', label: 'Blessing 2', baseTextImmutable: false, modules: [
        { type: 'blessing-slot', label: 'Blessing', editable: true, slots: [
          { id: 'blessing-2-he', label: 'Hebrew text', kind: 'text', editable: true },
          { id: 'blessing-2-en', label: 'English text', kind: 'text', editable: true },
        ] },
      ] },
    ],
  },
]

// ─── Lookup helpers (used by every call site that was previously hardcoded) ──

/** Get a template by id, or `undefined` if unknown. */
export function getBookTemplate(id: string): BookTemplate | undefined {
  return BOOK_TEMPLATES.find((t) => t.id === id)
}

/** All templates, in registry order (drives the new-project cards + admin list). */
export function listBookTemplates(): BookTemplate[] {
  return [...BOOK_TEMPLATES]
}

/** Just the ids (replaces the hardcoded `TEMPLATES` array in the admin route). */
export function listTemplateIds(): string[] {
  return BOOK_TEMPLATES.map((t) => t.id)
}

/**
 * The effective page count for a freshly-created project of this template.
 * Replaces the hardcoded `templatePageCounts` map in `app/api/project/route.ts`.
 * `requestedPageCount` (the create-slider value) wins for flowing books; fixed
 * books ignore it and use their locked count.
 */
export function getTemplatePageCount(id: string, requestedPageCount?: number): number {
  const t = getBookTemplate(id)
  if (!t) return requestedPageCount || 10
  if (t.pagePolicy === 'fixed') return t.fixedPageCount ?? t.defaultPageCount
  return requestedPageCount || t.defaultPageCount
}

/** Image dirs to add to TEXINPUTS for a template (replaces hardcoded haggadah dirs). */
export function getTemplateImageDirs(id: string): string[] {
  return getBookTemplate(id)?.imageDirs ?? []
}

/** The AI system prompt for a template (replaces the single hardcoded const). */
export function getTemplateSystemPrompt(id: string): string {
  const t = getBookTemplate(id)
  return getSystemPrompt(t?.systemPromptId ?? 'haggadah')
}

/** Whether a template's page count is locked (drives the create-page slider + overflow guard). */
export function isFixedPageTemplate(id: string): boolean {
  return getBookTemplate(id)?.pagePolicy === 'fixed'
}
