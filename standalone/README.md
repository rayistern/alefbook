# Haggadah Shel Pesach — Standalone LaTeX Project

A bilingual Hebrew/English Passover Haggadah, ready to edit with Claude Code.

## Quick Start

### 1. Install prerequisites

**Ubuntu/Debian:**
```bash
sudo apt-get install -y \
  texlive-xetex texlive-latex-base texlive-latex-extra \
  texlive-latex-recommended texlive-fonts-recommended \
  texlive-fonts-extra texlive-pictures texlive-plain-generic \
  texlive-lang-arabic texlive-lang-other fonts-ebgaramond
```

**macOS (with MacTeX):**
```bash
brew install --cask mactex
# Install EB Garamond from https://fonts.google.com/specimen/EB+Garamond
```

### 2. Compile
```bash
xelatex -interaction=nonstopmode haggadah.tex
xelatex -interaction=nonstopmode haggadah.tex
```

### 3. Edit with Claude Code
Open this directory in Claude Code. The `CLAUDE.md` file contains all the
instructions Claude needs to understand the document structure, make edits,
and compile.

Example prompts:
- "Change the title page to say 'Family Haggadah 2026'"
- "Add a new English paragraph after the Four Questions explaining their significance"
- "Translate the Kadesh blessing instructions into Spanish instead of English"
- "Add a page break before the Hallel section"
- "Replace the Korech illustration with a new image I'll upload"

## Files

| File | Description |
|------|-------------|
| `haggadah.tex` | Main LaTeX source (~1850 lines) |
| `fonts/` | Hebrew fonts (5 files): EFT Texty, Secular One, SimpleCLM, Yiddishkeit |
| `images/` | 15 seder step illustrations (PNG) |
| `CLAUDE.md` | Instructions for Claude Code — editing rules, architecture, pitfalls |

## Technical Notes
- **Engine**: XeLaTeX (required for Unicode Hebrew + OpenType fonts)
- **Page size**: 7×10 inches (standard book trim)
- **Layout**: `paracol` bilingual columns — English left (46%), Hebrew right (54%)
- **RTL**: Handled by `polyglossia` + `bidi`
- **Output**: ~49 page PDF
