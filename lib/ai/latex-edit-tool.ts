/**
 * Diff-based LaTeX editing via LLM tool calls.
 *
 * Instead of asking the LLM to return the entire 1800+ line document,
 * we give it a search-and-replace tool. The LLM returns only the
 * specific changes it wants to make, and we apply them surgically.
 *
 * This mirrors how Claude Code edits files: read → find exact text → replace.
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

export interface EditToolResult {
  /** The modified LaTeX source */
  latex: string
  /** Conversational reply to the user */
  reply: string
  /** Individual edits that were applied */
  edits: SearchReplaceEdit[]
  /** Edits that failed to apply (search string not found or not unique) */
  failedEdits: { edit: SearchReplaceEdit; error: string }[]
}

// ── System prompt ──────────────────────────────────────────────────────────

const EDIT_SYSTEM_PROMPT = `You are a LaTeX document editor for AlefBook, a Hebrew/English Haggadah platform.

## How to make edits
You have a SEARCH/REPLACE tool. For each change you want to make, return a block like this:

<<<SEARCH
exact text from the document to find
>>>
<<<REPLACE
the replacement text
>>>

Rules for SEARCH/REPLACE blocks:
- The SEARCH text must be an EXACT substring of the document (including whitespace and newlines).
- The SEARCH text must be UNIQUE in the document. If a short snippet appears more than once (e.g. a color definition used on multiple pages), include enough surrounding lines to make it unambiguous. Always include 5+ lines of context around the change — more context is always better than less.
- You can return multiple SEARCH/REPLACE blocks for multiple changes.
- Only change what the user asked for. Do NOT refactor, reorganize, or "improve" unrelated code.
- Preserve all existing formatting, spacing, and comments exactly as-is for untouched sections.

## How to respond
1. First, write a brief reply (1-3 sentences) explaining what you changed.
2. Then include your SEARCH/REPLACE blocks.

## Rules
- NEVER return the full document. Only return the specific sections you're changing.
- If the user asks a question without requesting changes, just reply — no SEARCH/REPLACE blocks needed.
- Hebrew text is RTL. Be careful with bidi commands (\\\\beginR, \\\\endR, \\\\texthebrew{}).
- Do not remove or modify \\\\usepackage declarations unless explicitly asked.
- The user's request always takes priority over style guidelines.

## Image generation
- You CANNOT generate images yourself. Do NOT use TikZ, pgfplots, or any LaTeX drawing to create illustrations.
- The system generates images externally. When it succeeds, you will see \`[System: An image has been generated and saved as images/filename.png. Insert it using \\includegraphics{images/filename.png}...]\`. Follow those instructions to insert the image.
- If there is NO [System: An image has been generated...] tag in the message, it means image generation was not attempted or failed. Do NOT try to create the image yourself with TikZ or any other method. Instead, just make any other requested edits and mention that the image could not be generated.

## File uploads
- \`[Uploaded: filename.png]\` means an image was uploaded to project storage. To use it: \\\\includegraphics{images/filename.png}. Use the EXACT filename from the tag — do NOT shorten, rename, or strip any prefix. If the tag says \`[Uploaded: upload-12345-photo.jpg]\`, use exactly \`\\\\includegraphics{images/upload-12345-photo.jpg}\`.
- \`[File: filename.txt]...[/File]\` means the user attached a text file. The content between the tags IS the file content. Use it to fulfill the user's request (e.g. if they say "replace the English with this Spanish" and attach a file, use the file content as the replacement text).
- These tags are system-generated, not typed by the user. The user's actual request is the text outside these tags.

## Chat history
- You have access to the conversation history. Use context from earlier messages to understand follow-up requests like "try again" or "undo that".`

// ── Parser ─────────────────────────────────────────────────────────────────

/**
 * Parse SEARCH/REPLACE blocks from the LLM response.
 */
export function parseSearchReplaceBlocks(response: string): {
  reply: string
  edits: SearchReplaceEdit[]
} {
  const edits: SearchReplaceEdit[] = []

  // Match all <<<SEARCH ... >>> <<<REPLACE ... >>> pairs
  const pattern = /<<<SEARCH\n([\s\S]*?)>>>\n<<<REPLACE\n([\s\S]*?)>>>/g
  let match

  while ((match = pattern.exec(response)) !== null) {
    edits.push({
      search: match[1].replace(/\n$/, ''),  // trim trailing newline from capture
      replace: match[2].replace(/\n$/, ''),
    })
  }

  // Everything before the first <<<SEARCH block is the conversational reply
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
 * This handles cases where the LLM gets trailing spaces wrong.
 */
function fuzzyReplace(document: string, search: string, replace: string): string | null {
  const normalizeLines = (s: string) => s.split('\n').map(l => l.trimEnd()).join('\n')
  const normalizedDoc = normalizeLines(document)
  const normalizedSearch = normalizeLines(search)

  const idx = normalizedDoc.indexOf(normalizedSearch)
  if (idx === -1) return null

  // Count occurrences in normalized form
  let count = 0
  let pos = 0
  while ((pos = normalizedDoc.indexOf(normalizedSearch, pos)) !== -1) {
    count++
    pos += normalizedSearch.length
  }
  if (count !== 1) return null

  // Find the corresponding position in the original document
  // by counting characters up to the match point
  const before = normalizedDoc.slice(0, idx)
  const origLinesBefore = document.split('\n')
  const normLinesBefore = before.split('\n')
  const lineCount = normLinesBefore.length - 1

  // Reconstruct the original start position
  let origIdx = 0
  for (let i = 0; i < lineCount; i++) {
    origIdx += origLinesBefore[i].length + 1 // +1 for \n
  }
  origIdx += normLinesBefore[normLinesBefore.length - 1].length

  // Find the end position by counting lines in the search string
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

// ── Main entry point ───────────────────────────────────────────────────────

/**
 * Edit a LaTeX document using the search/replace tool approach.
 * The LLM only returns the specific changes, not the entire document.
 */
export async function editDocumentWithTool(params: {
  currentDocument: string
  instruction: string
  chatHistory: { role: string; content: string }[]
  model?: string
}): Promise<EditToolResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chat history role types
  const messages: any[] = [
    { role: 'system', content: EDIT_SYSTEM_PROMPT },
    ...params.chatHistory.slice(-20).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    {
      role: 'user',
      content: `## Current document:\n\`\`\`latex\n${params.currentDocument}\n\`\`\`\n\n## User message: ${params.instruction}`,
    },
  ]

  const response = await callLLM(messages, {
    model: params.model,
    maxTokens: 16384,  // Much less than 65536 — we only need the diffs
    temperature: 0.2,
  })

  // Parse the search/replace blocks
  const { reply, edits } = parseSearchReplaceBlocks(response)

  // Log the actual edits for debugging
  for (const edit of edits) {
    console.log(`[EditTool] SEARCH (${edit.search.length} chars): ${edit.search.slice(0, 120).replace(/\n/g, '\\n')}...`)
    console.log(`[EditTool] REPLACE (${edit.replace.length} chars): ${edit.replace.slice(0, 120).replace(/\n/g, '\\n')}...`)
  }

  if (edits.length === 0) {
    // No edits — just a conversational reply (question, greeting, etc.)
    return {
      latex: params.currentDocument,
      reply,
      edits: [],
      failedEdits: [],
    }
  }

  // Apply edits to the document
  let { result, applied, failed } = applyEdits(params.currentDocument, edits)

  // Auto-retry failed edits once — ask the LLM to fix its search strings
  if (failed.length > 0 && applied.length >= 0) {
    console.log(`[EditTool] ${failed.length} edits failed, retrying with error feedback...`)
    const retryResult = await retryFailedEdits(result, failed, params.model)
    if (retryResult) {
      result = retryResult.result
      applied = [...applied, ...retryResult.applied]
      failed = retryResult.failed
    }
  }

  // Sanitize and validate
  const sanitized = sanitizeLatex(result)
  const validation = validateLatex(sanitized)

  if (!validation.valid) {
    console.error('[EditTool] Edits produced invalid LaTeX:', validation.warnings)
    return {
      latex: params.currentDocument,
      reply: reply + '\n\n(Warning: my edits produced invalid LaTeX — changes were not applied.)',
      edits: [],
      failedEdits: edits.map(e => ({ edit: e, error: 'Resulted in invalid LaTeX' })),
    }
  }

  // Log results
  if (failed.length > 0) {
    console.warn('[EditTool] Some edits still failed after retry:', failed.map(f => f.error))
  }
  console.log(`[EditTool] Final: ${applied.length}/${edits.length} edits applied`)

  return {
    latex: sanitized,
    reply: failed.length > 0
      ? reply + `\n\n(Note: ${failed.length} of ${edits.length} edits couldn't be applied — the text I was looking for may have changed.)`
      : reply,
    edits: applied,
    failedEdits: failed,
  }
}

/**
 * Retry failed edits by showing the LLM what went wrong and the surrounding
 * document context so it can produce more specific SEARCH strings.
 */
async function retryFailedEdits(
  document: string,
  failed: { edit: SearchReplaceEdit; error: string }[],
  model?: string
): Promise<{
  result: string
  applied: SearchReplaceEdit[]
  failed: { edit: SearchReplaceEdit; error: string }[]
} | null> {
  const failureDescriptions = failed.map(f => {
    // For "found N times" errors, show nearby context to help the LLM disambiguate
    let context = ''
    if (f.error.includes('found') && f.error.includes('times')) {
      const idx = document.indexOf(f.edit.search.slice(0, 40))
      if (idx !== -1) {
        const start = Math.max(0, idx - 200)
        const end = Math.min(document.length, idx + f.edit.search.length + 200)
        context = `\n\nFirst occurrence context (chars ${start}-${end}):\n\`\`\`\n${document.slice(start, end)}\n\`\`\``
      }
    }
    return `FAILED EDIT:\nSearch: ${JSON.stringify(f.edit.search.slice(0, 200))}\nReplace with: ${JSON.stringify(f.edit.replace.slice(0, 200))}\nError: ${f.error}${context}`
  }).join('\n\n---\n\n')

  try {
    const response = await callLLM(
      [
        {
          role: 'system' as const,
          content: `You are a LaTeX editor. Some SEARCH/REPLACE edits failed. Fix them by providing corrected SEARCH/REPLACE blocks.

Rules:
- The SEARCH text must be UNIQUE in the document. Include MORE surrounding lines (5-10 lines of context) to ensure uniqueness.
- The REPLACE text should achieve the same edit as originally intended.
- Use the <<<SEARCH ... >>> <<<REPLACE ... >>> format.
- Do NOT add commentary — just return the corrected SEARCH/REPLACE blocks.`,
        },
        {
          role: 'user' as const,
          content: `The following edits failed. Please provide corrected versions with more context in the SEARCH strings.\n\n${failureDescriptions}\n\n## Current document:\n\`\`\`latex\n${document}\n\`\`\``,
        },
      ],
      { model, maxTokens: 8192, temperature: 0.1 }
    )

    const { edits: retryEdits } = parseSearchReplaceBlocks(response)
    if (retryEdits.length === 0) return null

    const retryResult = applyEdits(document, retryEdits)
    console.log(`[EditTool] Retry: ${retryResult.applied.length}/${retryEdits.length} edits applied`)
    return retryResult
  } catch (err) {
    console.warn('[EditTool] Retry failed:', err)
    return null
  }
}

/**
 * Self-correct a failed compile using the same search/replace approach.
 * Much safer than asking the LLM to regenerate the entire document.
 */
export async function selfCorrectWithTool(params: {
  document: string
  errors: string[]
  log: string
  model?: string
}): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chat message role types
  const messages: any[] = [
    {
      role: 'system',
      content: `You are a LaTeX debugger. A document failed to compile. Fix ONLY the errors using SEARCH/REPLACE blocks. Do NOT change anything unrelated to the errors.

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
