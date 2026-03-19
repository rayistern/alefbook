# Haggadah Shel Pesach — Standalone LaTeX Project

A bilingual Hebrew/English Passover Haggadah, ready to edit with Claude.

## Quick Start

1. Upload this directory's contents to Claude
2. Ask Claude to make edits (e.g., "Change the title page to say 'Family Haggadah 2026'")
3. Compile with: `xelatex -interaction=nonstopmode haggadah.tex` (run twice)

## Files

| File | Description |
|------|-------------|
| `haggadah.tex` | Main LaTeX source |
| `fonts/` | Hebrew fonts (5 files) |
| `images/` | 17 seder step illustrations (PNG) |
| `CLAUDE.md` | Editing instructions for Claude |

## Technical Notes
- **Engine**: XeLaTeX (required for Unicode Hebrew + OpenType fonts)
- **Page size**: 7x10 inches (standard book trim)
- **Layout**: `paracol` bilingual columns — English left (46%), Hebrew right (54%)
- **System font required**: EB Garamond (install via `apt install fonts-ebgaramond`)
