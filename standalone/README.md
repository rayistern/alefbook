# Standalone Haggadah Projects

Self-contained LaTeX Haggadah projects, ready to drop into Claude for editing.

## Available Templates

| Directory | Description |
|-----------|-------------|
| `haggadah/` | Classic adult Haggadah — elegant serif fonts, gold ornaments |
| `haggadah-kids/` | Children's edition — playful fonts, cartoon illustrations, bright colors |

## How to Use

Each directory is fully self-contained with its own `.tex` file, fonts, and images.
Upload the directory contents to Claude and start editing.

## Keeping in Sync

These directories are **generated** by `scripts/sync-standalone.sh` from the
template sources of truth in `templates/`. Do not edit standalone `.tex` files
directly — changes will be overwritten on the next sync. Instead:

1. Edit the adult template: `templates/haggadah-latex/source.tex` (body content)
2. Edit kids styling: `templates/haggadah-kids-latex/preamble.tex`
3. Run: `bash scripts/sync-standalone.sh`
