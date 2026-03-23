/**
 * Diff-based LaTeX editing utilities.
 *
 * Provides search-and-replace edit parsing and application.
 * The orchestrator handles the LLM tool-calling loop; this module
 * provides the parsing, application, and self-correction helpers.
 */

import { callLLM } from './openrouter'
import { sanitizeLatex, validateLatex } from './latex-editor'

// ── Types ──────────────────────────────────────────────────────────────────

export interface SearchReplaceEdit {
  /** Exact string to find in the document (must be unique) */
  search: string
  /** Replacement string */
  replace: string
  /** Optional description of why this change is being made */
  reason?: string
}

// ── Parser ─────────────────────────────────────────────────────────────────

/**
 * Parse SEARCH/REPLACE blocks from a text response.
 * Used by selfCorrectWithTool which still uses text-based format.
 */
export function parseSearchReplaceBlocks(response: string): {
  reply: string
  edits: SearchReplaceEdit[]
} {
  const edits: SearchReplaceEdit[] = []

  const pattern = /<<<SEARCH\n([\s\S]*?)>>>\n<<<REPLACE\n([\s\S]*?)>>>/g
  let match

  while ((match = pattern.exec(response)) !== null) {
    edits.push({
      search: match[1].replace(/\n$/, ''),
      replace: match[2].replace(/\n$/, ''),
    })
  }

  const firstBlock = response.indexOf('<<<SEARCH')
  const reply = firstBlock > 0
    ? response.slice(0, firstBlock).trim()
    : response.trim()

  return { reply, edits }
}

// ── Applicator ─────────────────────────────────────────────────────────────

/**
 * Apply a list of search/replace edits to a document.
 * Each edit's search string must appear exactly once in the document.
 */
export function applyEdits(
  document: string,
  edits: SearchReplaceEdit[]
): {
  result: string
  applied: SearchReplaceEdit[]
  failed: { edit: SearchReplaceEdit; error: string }[]
} {
  let result = document
  const applied: SearchReplaceEdit[] = []
  const failed: { edit: SearchReplaceEdit; error: string }[] = []

  for (const edit of edits) {
    const occurrences = countOccurrences(result, edit.search)
    console.log(`[applyEdits] Search (${edit.search.length} chars) → ${occurrences} occurrences`)

    if (occurrences === 0) {
      // Try a fuzzy match — strip leading/trailing whitespace per line
      const fuzzyResult = fuzzyReplace(result, edit.search, edit.replace)
      if (fuzzyResult) {
        const changed = fuzzyResult !== result
        console.log(`[applyEdits] Fuzzy match applied, doc changed: ${changed}`)
        result = fuzzyResult
        applied.push(edit)
      } else {
        console.log(`[applyEdits] FAILED: not found even with fuzzy matching`)
        failed.push({ edit, error: 'Search string not found in document' })
      }
    } else if (occurrences === 1) {
      if (edit.search === edit.replace) {
        console.log(`[applyEdits] SKIPPED: search and replace are identical`)
        failed.push({ edit, error: 'Search and replace text are identical — no change made' })
      } else {
        // Use indexOf + slice instead of String.replace() to avoid $ replacement patterns
        // (LaTeX is full of $ signs which JS interprets as special replacement patterns)
        const idx = result.indexOf(edit.search)
        const before = result.length
        result = result.slice(0, idx) + edit.replace + result.slice(idx + edit.search.length)
        console.log(`[applyEdits] Exact match applied at pos ${idx}, length ${before} → ${result.length}`)
        applied.push(edit)
      }
    } else {
      console.log(`[applyEdits] FAILED: found ${occurrences} times`)
      failed.push({
        edit,
        error: `Search string found ${occurrences} times (must be unique). Include more surrounding context.`,
      })
    }
  }

  return { result, applied, failed }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let pos = 0
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++
    pos += needle.length
  }
  return count
}

/**
 * Try to match after normalizing whitespace on each line.
 * Handles cases where the LLM gets trailing spaces wrong.
 */
function fuzzyReplace(document: string, search: string, replace: string): string | null {
  const normalizeLines = (s: string) => s.split('\n').map(l => l.trimEnd()).join('\n')
  const normalizedDoc = normalizeLines(document)
  const normalizedSearch = normalizeLines(search)

  const idx = normalizedDoc.indexOf(normalizedSearch)
  if (idx === -1) return null

  let count = 0
  let pos = 0
  while ((pos = normalizedDoc.indexOf(normalizedSearch, pos)) !== -1) {
    count++
    pos += normalizedSearch.length
  }
  if (count !== 1) return null

  const before = normalizedDoc.slice(0, idx)
  const origLinesBefore = document.split('\n')
  const normLinesBefore = before.split('\n')
  const lineCount = normLinesBefore.length - 1

  let origIdx = 0
  for (let i = 0; i < lineCount; i++) {
    origIdx += origLinesBefore[i].length + 1
  }
  origIdx += normLinesBefore[normLinesBefore.length - 1].length

  const searchLines = normalizedSearch.split('\n')
  let origEnd = origIdx
  for (let i = 0; i < searchLines.length; i++) {
    if (i === searchLines.length - 1) {
      origEnd += origLinesBefore[lineCount + i]?.trimEnd().length ?? searchLines[i].length
    } else {
      origEnd += (origLinesBefore[lineCount + i]?.length ?? searchLines[i].length) + 1
    }
  }

  return document.slice(0, origIdx) + replace + document.slice(origEnd)
}

// ── Self-correction (compile error fixing) ────────────────────────────────

/**
 * Self-correct a failed compile using search/replace.
 * Uses text-based SEARCH/REPLACE format (not tool calling) since
 * this is a focused, single-purpose task.
 */
export async function selfCorrectWithTool(params: {
  document: string
  errors: string[]
  log: string
  model?: string
}): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    {
      role: 'system',
      content: `You are a LaTeX debugger. A document failed to compile. Fix ONLY the errors using SEARCH/REPLACE blocks. Do NOT change anything unrelated to the errors.

## Common pitfalls to check:
- **Color syntax**: NEVER use CSS-style \`#RRGGBB\` in LaTeX — the # is invalid. NEVER use inline HTML color syntax like \`fill={HTML}{...}\` or \`color[HTML]{...}\` inside TikZ environments (especially \\AddToShipoutPictureBG or remember picture overlays) — this will fail. The ONLY safe fix: define a named color in the preamble with \`\\definecolor{name}{HTML}{RRGGBB}\` and reference it by name (e.g. \`fill=name\`).

## Errors:
${params.errors.join('\n\n')}

## Log excerpt (last 2000 chars):
${params.log.slice(-2000)}

Use the SEARCH/REPLACE format:
<<<SEARCH
exact text causing the error
>>>
<<<REPLACE
corrected text
>>>

Fix the minimum amount of code needed. Do not reorganize or refactor.`,
    },
    {
      role: 'user',
      content: `\`\`\`latex\n${params.document}\n\`\`\`\n\nFix the compilation errors using SEARCH/REPLACE blocks.`,
    },
  ]

  const response = await callLLM(messages, {
    model: params.model,
    maxTokens: 8192,
    temperature: 0.1,
  })

  const { edits } = parseSearchReplaceBlocks(response)
  const { result } = applyEdits(params.document, edits)

  const validation = validateLatex(result)
  if (!validation.valid) {
    console.error('[SelfCorrect] Fix produced invalid LaTeX, keeping original')
    return params.document
  }

  return sanitizeLatex(result)
}
