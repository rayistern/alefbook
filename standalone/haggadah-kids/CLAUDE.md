# Children's Haggadah LaTeX Project — Editing Instructions

## What This Is
A kid-friendly bilingual Hebrew/English Passover Haggadah typeset in LaTeX.
Same complete text as the adult version, with playful fonts, cartoon
illustrations, bright colors, and star decorations.

## Directory Structure
```
haggadah-kids.tex     # Main LaTeX source file
fonts/                # Fonts (12 files — Hebrew + kids English display fonts)
images/               # Cartoon seder step illustrations (17 PNG files)
```

## How to Compile

### Prerequisites
```bash
# Ubuntu/Debian
sudo apt-get install -y \
  texlive-xetex texlive-latex-base texlive-latex-extra \
  texlive-latex-recommended texlive-fonts-recommended \
  texlive-fonts-extra texlive-pictures texlive-plain-generic \
  texlive-lang-arabic texlive-lang-other

# macOS (via MacTeX / Homebrew)
brew install --cask mactex
```

Note: Unlike the adult version, this does NOT require EB Garamond — all
fonts are bundled in `fonts/` (Gill Sans for English body text).

### Compile (two passes required)
```bash
xelatex -interaction=nonstopmode haggadah-kids.tex
xelatex -interaction=nonstopmode haggadah-kids.tex
```

## Font Guide

| Font | Used For |
|------|----------|
| Gill Sans | English body text |
| Cooper Black (`COOPBL`) | English subtitle in section headers |
| Acme Secret Agent BB | Instruction boxes |
| FredokaOne | English step titles (transliteration) |
| EFT Texty | Hebrew body text |
| Secular One | Hebrew sans / sub-headings |
| SimpleCLM | Hebrew emphasis |
| Yiddishkeit | Hebrew decorative titles |

## How to Edit

### General Rules
- **NEVER return the full document.** Always make surgical edits.
- After editing, compile with two passes of `xelatex`.
- If compilation fails, read the `.log` file and fix lines starting with `!`.

### Key Custom Commands

| Command | Purpose |
|---------|---------|
| `\sedersection{Hebrew}{Translit}{English}{#}` | Seder step header (stars + dashed lines) |
| `\instruction{text}` | Rounded instruction box (Acme Secret Agent font) |
| `\texthebrew{text}` | Inline Hebrew in RTL mode |
| `\subsedertitle{Hebrew}{English}` | Sub-section heading |

### Design Differences from Adult Version
- **Colors**: Bright blue (#1565C0), orange (#F57C00), purple (#7B1FA2)
- **Ornaments**: Stars instead of floral pgfornament patterns
- **Rules**: Dashed/dotted lines instead of solid
- **Boxes**: Rounded corners (arc=6pt) with visible borders
- **Page decorations**: Corner stars instead of corner ornaments

### Common Pitfalls
- Same as adult version — see the bilingual layout rules
- **Missing `\end{hebrew}`**: Breaks ALL subsequent text direction
- **Unbalanced `paracol`**: Causes "missing $ inserted" cascade
- **Package load order**: `polyglossia` MUST be last before `\begin{document}`

### What NOT to Change (Unless Asked)
- Font declarations and scales
- Page geometry (7x10" trim for print)
- The `polyglossia` load order
- Star decorations and dashed rules (part of the kids design language)
