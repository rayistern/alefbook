# Haggadah LaTeX Project — Editing Instructions

## What This Is
A bilingual Hebrew/English Passover Haggadah typeset in LaTeX.
Uses XeLaTeX with `polyglossia` for Hebrew/RTL support and
`paracol` for side-by-side bilingual columns.

## Directory Structure
```
haggadah.tex          # Main LaTeX source file
fonts/                # Hebrew fonts (5 files, referenced by Path= in the .tex)
images/               # Seder step illustrations (17 PNG files)
```

## How to Compile

### Prerequisites
```bash
# Ubuntu/Debian
sudo apt-get install -y \
  texlive-xetex texlive-latex-base texlive-latex-extra \
  texlive-latex-recommended texlive-fonts-recommended \
  texlive-fonts-extra texlive-pictures texlive-plain-generic \
  texlive-lang-arabic texlive-lang-other fonts-ebgaramond

# macOS (via MacTeX / Homebrew)
brew install --cask mactex
# Then install EB Garamond from Google Fonts
```

### Compile (two passes required)
```bash
xelatex -interaction=nonstopmode haggadah.tex
xelatex -interaction=nonstopmode haggadah.tex
```

**IMPORTANT**: Must use XeLaTeX (not pdflatex or lualatex).

## How to Edit

### General Rules
- **NEVER return the full document.** Always make surgical edits.
- After editing, compile with two passes of `xelatex -interaction=nonstopmode haggadah.tex`.
- If compilation fails, read the `.log` file, find lines starting with `!`, and fix only those errors.

### Key Custom Commands

| Command | Purpose | Example |
|---------|---------|---------|
| `\sedersection{Hebrew}{Translit}{English}{#}` | Seder step header with ornaments | `\sedersection{קדש}{Kadesh}{Sanctification}{1}` |
| `\instruction{text}` | Instruction box | `\instruction{Pour the first cup...}` |
| `\texthebrew{text}` | Inline Hebrew in RTL mode | `\texthebrew{ברוך אתה}` |
| `\subsedertitle{Hebrew}{English}` | Sub-section heading | `\subsedertitle{מה נשתנה}{The Four Questions}` |

### Bilingual Column Layout
```latex
\begin{paracol}{2}
English text on the left column...

\switchcolumn
\begin{hebrew}
Hebrew text on the right column (RTL)...
\end{hebrew}
\end{paracol}
```

### Hebrew Text Rules
- Block Hebrew: `\begin{hebrew}...\end{hebrew}`
- Inline Hebrew: `\texthebrew{...}`
- `polyglossia` handles RTL automatically inside `{hebrew}` environments
- **Do NOT** manually use `\beginR`/`\endR` in new content

### Common Pitfalls
- **Missing `\end{hebrew}`**: Breaks ALL subsequent text direction
- **Unbalanced `paracol`**: Causes "missing $ inserted" cascade
- **Package load order**: `polyglossia` MUST be last before `\begin{document}`
- **EB Garamond not found**: Must be installed as a system font
- **FreeSans not found**: Install `texlive-fonts-extra`

### What NOT to Change (Unless Asked)
- Font declarations and scales
- Page geometry (7x10" trim for print)
- The `polyglossia` load order
- Decorative ornaments and gold rules
