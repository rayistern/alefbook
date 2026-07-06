# Template Registry (closes issue #14)

**Status:** ALEF2 first advance — data-driven product layer. Part of the
alefbook.org reframe. See the ALEF1 recon:
`batches/audits/alefbook-shopify-mechaber-recon-2026-07-06.md` (in the
chatbuilds repo).

## Why

Before this, the product layer was hardwired to the Haggadah in ~4 code sites +
a hardcoded AI system prompt + hardcoded TEXINPUTS image dirs. Adding a book
meant a code change + redeploy + a manual curl (issue #14). Now **adding a book
is a data row** in `lib/templates/registry.ts` (plus, for file-backed books, a
`source.tex` asset). Nothing else has to change.

## The data model (ported from mechaber)

The shape is ported from merkos-302/mechaber's `frontend/src/studio/`
`ArtifactTemplate[]` registry (`artifactTypes.ts` + `artifactTemplates.ts`).
We adopt mechaber's **data model** — a template = metadata + a declared
structure of sections/modules/slots + a `documentSetup` — but **keep alefbook's
XeLaTeX → PDF renderer** (its print-grade moat). We do NOT adopt mechaber's
HTML/BlockNote render layer.

A `BookTemplate` (see `lib/templates/registry.ts`) carries:

- **Metadata**: `id`, `name`, `description`, `icon`, `cardGradient`, `intent`.
- **Page policy**: `pagePolicy: 'fixed' | 'flowing'`. Fixed books (the Haggadah)
  are page-locked — the orchestrator's overflow guard reverts edits that change
  the page count. Flowing books grow naturally. (This is issue #14's "overflow
  heuristic assumes fixed-page books" made a per-template policy.)
- **Asset**: how the LaTeX is obtained — a pre-authored `source.tex` **file**,
  or a named procedural **generator** (`blank`, `hebrew-english`).
- **imageDirs**: TEXINPUTS image dirs for this template (a book with no images
  contributes none — it no longer drags the Haggadah's image path into an
  unrelated build).
- **documentSetup**: trim size, bleed, binding, languages (the LaTeX analogue of
  mechaber's `documentSetup`).
- **branding**: the default brand name + the env key that overrides it
  (`NEXT_PUBLIC_BRAND_NAME`) — the de-hardcoding path for "Shluchim Exchange".
- **systemPromptId**: which AI system prompt this template uses.
- **structure**: the book's sections → modules → slots, as data.

### Static-text architecture (Rayi's constraint)

Liturgical books have a base text that is **immutable by construction** — the
designer personalises the wrapper (cover, colours, a Chabad-house name, added
images), never the sacred body. This is encoded per-section as
`baseTextImmutable` and per-module as `editable`. The Haggadah's 15 seder steps
are `baseTextImmutable: true` with only an optional image slot editable. Template
#2 sits at the opposite end — its blessing sections are editable slots the
designer fills.

## Template #1 — the Haggadah, now data

`getBookTemplate('haggadah')` is registry entry #1. Its previously-hardcoded
structure is now data: cover / title / TOC / the 15 seder steps (kadesh …
nirtzah) / back cover, with the liturgy marked immutable. Its `source.tex`,
image dir, fixed 52-page count, Chabad system prompt, and branding are all
fields. **Behaviour for existing Haggadah projects is preserved.**

### Note on the system prompt

The single hardcoded `SYSTEM_PROMPT` in `lib/ai/orchestrator.ts` was extracted
into the registry. It is now composed as a **product header** (Chabad content
policy, static-text invariant, Jewish-imagery guidance) + **shared LaTeX/tool
mechanics** (colour syntax, search_replace discipline, scope, overflow, image,
undo — identical for every book). This is a *restructure*, not a byte-identical
copy — no test asserts prompt text, and nothing here is deployed (deploys are
held). **Verify Haggadah edit quality before any go-live.** The visual-reviewer
prompts in `orchestrator.ts` are still Haggadah-flavoured — remaining #14 work.

## Template #2 — generalisation proof: Blessings Booklet

`blessings-booklet` proves the registry generalises. It differs from the
Haggadah on **every axis the registry abstracts**:

| Axis | Haggadah | Blessings Booklet |
|---|---|---|
| Page policy | `fixed` (52pp) | `flowing` |
| Asset | `templates/haggadah-latex/source.tex` | `templates/blessings-booklet-latex/source.tex` |
| Image dirs | `templates/haggadah-images` | *(none)* |
| System prompt | `haggadah` (Chabad) | `generic-booklet` (neutral) |
| Static-text | immutable liturgy | editable slots the designer fills |
| Trim | 7×10in perfect-bound | 5.5×8.5in saddle-stitch |

It was added with **zero changes to any call site** — that is the proof.

### CONTENT NOTE — no sourced sacred text

The booklet ships **placeholder slots**, not sourced liturgy. Real blessing text
is a content decision for the product owner; the designer/AI fills the slots.
The repo *does* contain Birkat-Hamazon (`3beirachHE1a.txt` / `3beirachEN1a.txt`)
as part of the Haggadah, but turning that into a standalone sellable product is a
product/halachic call, not one to make autonomously. The POC deliberately proves
the *mechanics* without publishing sacred text. **Walk-back:** to make it a real
bentcher, drop the liturgical text into the slots in
`templates/blessings-booklet-latex/source.tex`; to drop template #2 entirely,
remove its registry row + its `templates/blessings-booklet-latex/` dir (no call
site references it).

## What now reads the registry (the de-hardcoded call sites)

| Call site | Was | Now |
|---|---|---|
| `lib/latex/templates.ts` `getTemplate()` | `switch` on 4 ids | reads registry `asset` |
| `app/api/project/route.ts` | `templatePageCounts` map | `getTemplatePageCount()` |
| `app/project/new/page.tsx` | hardcoded card array | `listBookTemplates()` |
| `lib/latex/compiler.ts` TEXINPUTS | hardcoded haggadah dirs | `getTemplateImageDirs()` |
| `app/api/admin/compile-templates/route.ts` | `TEMPLATES` array + TEXINPUTS | `listTemplateIds()` + `getTemplateImageDirs()` |
| `lib/ai/orchestrator.ts` | one `SYSTEM_PROMPT` const | `getTemplateSystemPrompt(template_id)` |

## Adding a new book (the whole recipe now)

1. Add a `BookTemplate` row to `BOOK_TEMPLATES` in `lib/templates/registry.ts`.
2. For a file-backed book, add its `templates/<id>-latex/source.tex`.
3. (If it needs a distinct AI voice) add a system prompt to the registry's
   `SYSTEM_PROMPTS` map and point `systemPromptId` at it.
4. Compile its cached preview PDF via `POST /api/admin/compile-templates`
   (picks it up automatically from `listTemplateIds()`).

No edits to routes, the compiler, the new-project page, or the orchestrator.

## Tests

`lib/templates/__tests__/registry.test.ts` — Haggadah-is-#1, structure
extraction, static-text immutability, template-#2 generalisation on every axis,
and the lookup helpers (page-count policy, image dirs, prompt selection).
