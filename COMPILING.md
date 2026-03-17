# Compiling the Haggadah PDF

## Prerequisites

### TeX Distribution
- **XeLaTeX** (part of TeX Live) — required for Unicode/Hebrew support
- TeX Live 2023 or later

### Required TeX Live packages
Install on Ubuntu/Debian:
```bash
apt-get install -y \
  texlive-xetex \
  texlive-latex-base \
  texlive-latex-extra \
  texlive-latex-recommended \
  texlive-fonts-recommended \
  texlive-fonts-extra \
  texlive-pictures \
  texlive-plain-generic \
  texlive-lang-arabic \
  texlive-lang-other
```

Key LaTeX packages used (all included in the above):
- `polyglossia` + `bidi` — Hebrew/RTL support
- `fontspec` — OpenType/TrueType font loading
- `paracol` — bilingual parallel columns
- `tcolorbox` — decorative boxes (Shabbat additions, instructions)
- `pgfornament` — decorative ornaments
- `fancyhdr` — headers/footers
- `tikz` — decorative rules and overlays
- `eso-pic` — background page elements
- `hyperref` — PDF metadata

### Fonts
The `.tex` file references fonts from two locations:

1. **English body font** — EB Garamond, loaded from system path:
   `/usr/share/fonts/truetype/ebgaramond/`
   Install: `apt-get install fonts-ebgaramond`

2. **Hebrew fonts** — loaded from `templates/fonts/` (relative to the `.tex` file):
   - `EFT_TEXTY OTP.ttf` — body Hebrew text
   - `SecularOne-Regular.ttf` — section titles
   - `SimpleCLM-Medium.ttf` — subsection titles
   - `Yiddishkeit 2.0 AAA Bold.otf` — cover/decorative titles
   - `Yiddishkeit 2.0 AAA Regular.otf` — display text (e.g. "Next Year in Jerusalem")

### Images
Images are loaded from `newImages_notext/` (set via `\graphicspath`).
This directory must exist relative to the `.tex` file.

## Compilation

XeLaTeX requires **two passes** to resolve cross-references:

```bash
# First pass — generates the PDF and .aux file
xelatex -interaction=nonstopmode haggadah-fix-beirach.tex

# Second pass — resolves cross-references
xelatex -interaction=nonstopmode haggadah-fix-beirach.tex
```

The `-interaction=nonstopmode` flag prevents XeLaTeX from stopping on errors (it will log warnings and continue).

### Output
- `haggadah-fix-beirach.pdf` — the compiled PDF (49 pages)
- `haggadah-fix-beirach.log` — full compilation log
- `haggadah-fix-beirach.aux` — auxiliary file for cross-references

## Directory Structure

```
alefbook/
├── haggadah-fix-beirach.tex    # Main LaTeX source
├── haggadah-fix-beirach.pdf    # Compiled output
├── templates/
│   └── fonts/                  # Hebrew fonts (.ttf, .otf)
└── newImages_notext/           # Haggadah illustrations (.png)
```

## Orchestration Workflow (How AI Edits Work)

The orchestrator (`lib/ai/orchestrator.ts`) handles the full lifecycle of a user's
edit request. Here's the flow:

### 1. Intent Classification (regex, no LLM call)
```
User message → classify as "chat" | "question" | "edit"
```
- **chat**: greetings, short messages → quick LLM reply, no document loaded
- **question**: "what does X mean?" → load document, answer, no compile
- **edit**: "change the title to..." → full edit + compile loop

### 2. Load Document
- Download `main.tex` from Supabase Storage
- If it's an old split-file project (`\input{preamble}`), assemble into single file

### 3. Diff-Based Editing (`lib/ai/latex-edit-tool.ts`)

**This is the key innovation.** Instead of asking the LLM to return the entire
1800+ line document (which causes truncation), the LLM returns only
**SEARCH/REPLACE blocks**:

```
<<<SEARCH
\section{Kadesh}
\texthebrew{קדש}
Pour the first cup of wine.
>>>
<<<REPLACE
\section{Kadesh — Sanctification}
\texthebrew{קדש}
Pour the first cup of wine and raise it.
>>>
```

The applicator (`applyEdits`) then:
1. Finds the exact search string in the document
2. Verifies it appears exactly once (no ambiguity)
3. Replaces it with the new text
4. Falls back to fuzzy matching (whitespace-normalized) if exact match fails
5. Reports any edits that couldn't be applied

**Benefits over full-document replacement:**
- No truncation risk — LLM only outputs the changed sections
- Much lower token usage (~16K max vs ~65K)
- Failed edits are isolated — one bad edit doesn't destroy the whole doc
- Easy to log and debug exactly what changed

### 4. Upload & Compile
- Upload the modified `main.tex` to Supabase Storage
- Run `latexmk -xelatex` with a 2-minute timeout
- Image directories (`newImages_notext/`, etc.) are made available via `TEXINPUTS`

### 5. Self-Correction Loop (up to 3 attempts)
If compilation fails:
1. Parse LaTeX errors from the log (lines starting with `!`)
2. Send errors + document to LLM — again using **SEARCH/REPLACE** (not full-doc)
3. Apply fixes, re-upload, re-compile

### 6. Visual Review
After successful compile:
1. Ask LLM which pages the edit likely affected (text-only, cheap call)
2. Render those pages to PNG at 150 DPI via `pdftoppm`
3. Send page images to the LLM for visual QA (vision call)
4. If issues found, append a note to the user's response

### Flow Diagram
```
User message
  │
  ├─ chat ──→ quick LLM reply ──→ done
  │
  ├─ question ──→ load doc ──→ LLM answers ──→ done
  │
  └─ edit ──→ load doc
               │
               ├─ (optional) generate image
               │
               ▼
             LLM returns SEARCH/REPLACE blocks
               │
               ▼
             Apply edits surgically to main.tex
               │
               ▼
             Upload → Compile (latexmk -xelatex)
               │
               ├─ success ──→ visual review ──→ done
               │
               └─ failure ──→ LLM self-corrects via SEARCH/REPLACE
                               │
                               └─ retry compile (up to 3x)
```

### Key Files
| File | Role |
|------|------|
| `lib/ai/orchestrator.ts` | Main control flow — routes intents, runs edit/compile loop |
| `lib/ai/latex-edit-tool.ts` | SEARCH/REPLACE parser, applicator, fuzzy matching |
| `lib/ai/latex-editor.ts` | Sanitization (strip dangerous commands) + validation |
| `lib/ai/openrouter.ts` | LLM client (OpenRouter) with model fallback |
| `lib/latex/compiler.ts` | Downloads files from Supabase, runs `latexmk`, uploads PDF |
| `lib/latex/pdf-to-image.ts` | `pdftoppm` wrapper for rendering PDF pages to PNG |

## Troubleshooting

### "Font not found" errors
Ensure `templates/fonts/` contains all required font files and that EB Garamond is installed system-wide (`fonts-ebgaramond` package).

### Missing images
Ensure `newImages_notext/` exists and contains the referenced `.png` files.

### Hebrew text rendering issues
- Must use **XeLaTeX** (not pdflatex or lualatex)
- The `polyglossia` + `bidi` packages handle RTL; they must be loaded after all other packages

### Overfull/underfull warnings
These are cosmetic — the document sets high `\tolerance` and `\emergencystretch` values to minimize them, but some are expected with bilingual layout.
