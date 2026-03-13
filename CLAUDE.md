# Claude Code Instructions

## Shell Commands
- Never use `&&` to chain shell commands. Run each command separately.
- Use `cd` to change directory in one command, then run the next command separately.
- The working directory is `C:/Scripts/git/alefbook/alefbook`.

## Project
- This is a Next.js 14 app deployed to Railway via Docker.
- Git repo root is `alefbook/` (the inner directory).
- Railway project: brilliant-wholeness, service: alefbook.

## Page Editability
- Each page in `templates/metadata/pages.json` has an `editable` field (boolean).
- Pages with `editable: false` are **locked**: the AI cannot modify them, and the UI shows a warning banner + lock icon instead of allowing edits.
- To lock/unlock a page, change its `editable` value in `pages.json`. All pages default to `true`.
- Enforcement happens at three levels:
  1. **UI**: `PageViewer` shows a lock warning; `PageThumbnail` shows a lock icon.
  2. **AI prompt**: The system prompt tells the AI which pages are non-editable.
  3. **Server**: `designer-agent.ts` filters non-editable pages from intent targets and strips any page-html blocks the AI returns for locked pages.
