# Haggadah LaTeX Project — Claude Code Instructions

## What This Is
A bilingual Hebrew/English Passover Haggadah typeset in LaTeX (~1850 lines).
The document uses XeLaTeX with `polyglossia` for Hebrew/RTL support and
`paracol` for side-by-side bilingual columns.

## Directory Structure
```
haggadah.tex          # Main (and only) LaTeX source file
fonts/                # Hebrew fonts (5 files, referenced by Path= in the .tex)
images/               # Seder step illustrations (15 PNG files)
```

## How to Compile

### Prerequisites
```bash
# Ubuntu/Debian — install TeX Live + EB Garamond font
sudo apt-get install -y \
  texlive-xetex texlive-latex-base texlive-latex-extra \
  texlive-latex-recommended texlive-fonts-recommended \
  texlive-fonts-extra texlive-pictures texlive-plain-generic \
  texlive-lang-arabic texlive-lang-other fonts-ebgaramond

# macOS (via MacTeX / Homebrew)
brew install --cask mactex
# Then install EB Garamond from Google Fonts: https://fonts.google.com/specimen/EB+Garamond
```

### Compile (two passes required)
```bash
xelatex -interaction=nonstopmode haggadah.tex
xelatex -interaction=nonstopmode haggadah.tex
```

Or use latexmk:
```bash
latexmk -xelatex haggadah.tex
```

Output: `haggadah.pdf` (~49 pages)

**IMPORTANT**: Must use XeLaTeX (not pdflatex or lualatex). The document requires
Unicode/OpenType font support and the `polyglossia`+`bidi` RTL engine.

## How to Edit This Document

### General Rules
- **NEVER return the full document.** The file is ~1850 lines. Always make surgical edits.
- Use the Edit tool (search/replace) to change specific sections.
- After editing, compile with two passes of `xelatex -interaction=nonstopmode haggadah.tex`.
- If compilation fails, read the `.log` file, find lines starting with `!`, and fix only those errors.

### Document Architecture
The file is a single self-contained `.tex` file with this structure:

1. **Lines 1–18**: Page geometry (7×10 inch trim size)
2. **Lines 20–43**: Font declarations (EB Garamond for English, 5 Hebrew fonts)
3. **Lines 45–93**: Colors, graphics, layout packages, polyglossia
4. **Lines 95–175**: Spacing, headers/footers, page ornaments (TikZ + eso-pic)
5. **Lines 176–260**: Custom commands (`\sedersection`, `\sederchapterformat`, `\instructionbox`, `\winecup`)
6. **Lines 260+**: Document body — the actual Haggadah content

### Key Custom Commands

| Command | Purpose | Example |
|---------|---------|---------|
| `\sedersection{Hebrew}{Transliteration}{English}{#}` | Full-width seder step header with ornaments and illustration | `\sedersection{קדש}{Kadesh}{Sanctification}{1}` |
| `\instructionbox{text}` | Gold-bordered instruction box | `\instructionbox{Pour the first cup...}` |
| `\winecup` | Decorative wine cup symbol | Used inline in text |
| `\texthebrew{text}` | Inline Hebrew in RTL mode | `\texthebrew{ברוך אתה}` |

### Bilingual Column Layout
Most content pages use `paracol` for side-by-side layout:
```latex
\begin{paracol}{2}
English text on the left column...

\switchcolumn
\begin{hebrew}
Hebrew text on the right column (RTL)...
\end{hebrew}
\end{paracol}
```

- Left column = English (46% width)
- Right column = Hebrew (54% width)
- Column separator: gold vertical rule

### Hebrew Text Rules
- Hebrew body text: wrap in `\begin{hebrew}...\end{hebrew}` (block) or `\texthebrew{...}` (inline)
- The `polyglossia` package handles RTL automatically inside `{hebrew}` environments
- **Do NOT** manually use `\beginR`/`\endR` in new content — use the `{hebrew}` environment
- Hebrew font commands: `\hebrewfont` (body), `\hebrewfontsans` (sans), `\hebrewfonttitle` (titles), `\hebrewfontdisplay` (decorative)
- When mixing Hebrew and English in the same line, use `\texthebrew{...}` for the Hebrew parts

### Images
- All images are in `images/` and referenced via `\includegraphics{filename.png}`
- The `\graphicspath` is set to `images/` — no path prefix needed in `\includegraphics`
- Each seder step illustration is named `{step}1a.png` (e.g., `kadeish1a.png`, `korech1a.png`)
- Images are included in the `\sedersection` command via `\sederimage` (defined internally)

### Adding New Content
When adding new sections or prayers:
1. Find the right location in the document (sections are in Haggadah order)
2. Use `\begin{paracol}{2}...\end{paracol}` for bilingual content
3. Put English in the first column, Hebrew in `\switchcolumn` + `{hebrew}` environment
4. Use `\needspace{2in}` before major blocks to prevent awkward page breaks
5. Use `\instructionbox{}` for ritual instructions

### Common Pitfalls
- **Missing `\end{hebrew}`**: Every `\begin{hebrew}` needs a matching `\end{hebrew}`. A missing one will break ALL subsequent text direction.
- **Unbalanced `paracol`**: Each `\begin{paracol}{2}` needs `\end{paracol}`. Forgetting it causes a "missing $ inserted" cascade.
- **Brace mismatches in Hebrew text**: Hebrew text with nested braces is tricky to edit. Count your braces carefully.
- **Package load order**: `polyglossia` (which loads `bidi`) MUST be the last package loaded before `\begin{document}`. Moving it breaks RTL.
- **Overfull hbox warnings**: These are expected with bilingual layout. The document already sets `\tolerance=9999` and `\emergencystretch=3em`. Don't try to "fix" these unless text is visibly overflowing.
- **EB Garamond not found**: This font must be installed as a system font. On Linux: `apt install fonts-ebgaramond`. On macOS: download from Google Fonts and install.
- **FreeSans not found**: Install `texlive-fonts-extra` which includes FreeSans, or substitute with another sans font.

### Self-Correction After Compile Errors
If `xelatex` fails:
1. Read `haggadah.log` — look for lines starting with `!` (these are errors)
2. Common errors:
   - `! Missing $ inserted` → Usually an unbalanced `paracol` or `{hebrew}` environment
   - `! Undefined control sequence` → Typo in a command name, or missing package
   - `! Font ... not found` → Font file missing from `fonts/` directory
   - `! Emergency stop` → Usually a missing `\end{document}` or catastrophic brace mismatch
3. Fix ONLY the specific error. Do not refactor or reorganize surrounding code.
4. Re-compile and check again.

### What NOT to Change (Unless Asked)
- The preamble (lines 1–260) — it's carefully tuned for layout and typography
- Font declarations — the specific fonts and scales are design choices
- Page geometry — the 7×10" trim size is for print production
- The `polyglossia` load order (must be last before `\begin{document}`)
- Decorative elements (ornaments, gold rules) — they're part of the design language
