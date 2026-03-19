# Children's Haggadah — Standalone LaTeX Project

A kid-friendly bilingual Hebrew/English Passover Haggadah, ready to edit with Claude.

## Quick Start

1. Upload this directory's contents to Claude
2. Ask Claude to make edits
3. Compile with: `xelatex -interaction=nonstopmode haggadah-kids.tex` (run twice)

## Files

| File | Description |
|------|-------------|
| `haggadah-kids.tex` | Main LaTeX source |
| `fonts/` | All fonts (12 files — Hebrew + English display fonts) |
| `images/` | 17 cartoon seder step illustrations (PNG) |
| `CLAUDE.md` | Editing instructions for Claude |

## Technical Notes
- **Engine**: XeLaTeX (required for Unicode Hebrew + OpenType fonts)
- **Page size**: 7x10 inches (standard book trim)
- **Layout**: `paracol` bilingual columns — English left (46%), Hebrew right (54%)
- **No system fonts required**: All fonts are bundled in `fonts/`
