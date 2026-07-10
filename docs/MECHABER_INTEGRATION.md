# Mechaber → AlefBook Typesetting Integration

**Status:** seam landed (contract + converter, `lib/mechaber/bridge.ts`); endpoint +
mechaber-side adapter are the next phases. Part of the Torah/seforim reframe
(portfolio decision B5 — see the tracking issue "Decision: make alefbook
Torah-specific + integrate mechaber typesetting").

## The two halves, and why they fit

| | mechaber (merkos-302/mechaber) | alefbook (rayistern/alefbook) |
|---|---|---|
| What it is | Educator source-builder: teachers assemble Torah sources (via the Torah API) into shiurim, source sheets, worksheets | AI book-authoring platform with a print-grade XeLaTeX → PDF pipeline |
| Its "typesetting" | HTML/BlockNote + Paged.js browser print — screen/handout grade | XeLaTeX, real trim/bleed/binding, press-ready PDF — print grade |
| Export architecture | `ExportAdapter` registry (`frontend/src/studio/export/exportModel.ts`): docx, pdf (browser), print, google-docs, canva, png | — |
| Data model | `ArtifactTemplate` = metadata + sections/modules/slots + `documentSetup` | `BookTemplate` (`lib/templates/registry.ts`) — **already ported from mechaber's shape** (ALEF2/#14) |

Mechaber owns *authoring Torah content with sources*; alefbook owns *making it a
printed book*. The two registries already share a data model, so the integration
is an export adapter + an endpoint, not a rearchitecture. Mechaber deliberately
has **no god-IR** — each export adapter consumes its family's native source — and
this integration honors that: alefbook typesets the **flow-document family only**
(source sheets, shiurim, kuntresim), not design canvases.

## The contract (v1)

Defined in `lib/mechaber/bridge.ts`:

- **`MechaberTypesetRequest`** — versioned (`version: 1`), transport-neutral
  payload: artifact metadata (title, Hebrew title, author, provenance id), an
  optional `documentSetup` (trim size), and a flat list of **blocks**:
  `heading` / `paragraph` / `source` / `callout` / `page-break`, each optionally
  Hebrew (`lang: 'he'` → RTL rendering).
- **`source` blocks are verbatim mekorot.** The text arrives from mechaber
  (which got it from the Torah API); alefbook LaTeX-escapes and typesets it,
  never rewrites it. Same static-text discipline as the Haggadah's immutable
  liturgy.
- **`mechaberRequestToLatex(request)`** — pure function producing a complete,
  self-contained XeLaTeX `main.tex` (sha'ar/title page + body), using only
  packages the existing Docker TeX Live image installs. Output shape matches
  `getTemplate()` so the project-creation path is reusable unchanged.

## Phased plan

1. **Seam (this PR).** Contract types + pure converter + unit tests. No network,
   no schema changes, no behavior change for existing users.
2. **alefbook endpoint.** `POST /api/typeset`: authenticate (service token or
   the user's session), validate a `MechaberTypesetRequest`, create a project
   (template `sefer`-style, `pagePolicy: 'flowing'`), write the generated
   `main.tex`, run the existing compile pipeline, respond with
   `{ projectId, pdfUrl }`. Rate-limited like `/api/compile`. The project is a
   normal alefbook project afterwards — the author can keep refining it in the
   chat UI (covers, ornaments, images) before ordering print.
3. **mechaber-side adapter.** Register an `ExportAdapter` with a new
   `ExportTarget: 'alefbook-print'` labeled in teacher language ("Print as a
   booklet"). It flattens the flow document's BlockNote blocks into v1 blocks
   and POSTs to `/api/typeset`; per mechaber's honest-capability convention it
   ships `comingSoon: true` until the endpoint is live.
4. **Preferred mefarshim layouts (later).** Template variants that typeset a
   source sheet in classic mikraos-gedolos-style layouts (main text center,
   selected mefarshim in surrounding columns). This is where the "typeset with
   preferred mefarshim" vision lands; it needs real LaTeX layout work
   (multicol/flowfram) and should be driven by actual mechaber exports.

## Walk-back path

The seam is additive and isolated: `lib/mechaber/` has no imports from app
code and nothing imports it yet. Reverting = delete `lib/mechaber/` and this
doc. The `sefer` template row + generator are likewise pure additions to the
data-driven registry (removing the rows restores the prior product list).
