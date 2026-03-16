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
