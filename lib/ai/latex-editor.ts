/**
 * LaTeX editor: parse, sanitize, and validate AI-generated LaTeX content.
 */

/** Dangerous LaTeX commands that could execute shell commands or read files */
const FORBIDDEN_PATTERNS = [
  /\\write18\b/g,
  /\\immediate\s*\\write/g,
  /\\input\s*\{?\s*\//g,         // \input with absolute path
  /\\include\s*\{?\s*\//g,       // \include with absolute path
  /\\openout\b/g,
  /\\openin\b/g,
  /\\closeout\b/g,
  /\\closein\b/g,
  /\\catcode\b/g,
  /\\csname\s+end\s*\\endcsname/g,
  /\\newwrite\b/g,
  /\\newread\b/g,
  /\\read\b/g,
]

/**
 * Sanitize AI-generated LaTeX by stripping dangerous commands.
 */
export function sanitizeLatex(tex: string): string {
  let sanitized = tex

  for (const pattern of FORBIDDEN_PATTERNS) {
    sanitized = sanitized.replace(pattern, '% [STRIPPED: forbidden command]')
  }

  return sanitized
}

/**
 * Validate LaTeX source for basic structural correctness.
 */
export function validateLatex(tex: string): { valid: boolean; warnings: string[] } {
  const warnings: string[] = []

  if (!tex.includes('\\documentclass')) {
    warnings.push('Missing \\documentclass')
  }
  if (!tex.includes('\\begin{document}')) {
    warnings.push('Missing \\begin{document}')
  }
  if (!tex.includes('\\end{document}')) {
    warnings.push('Missing \\end{document}')
  }

  // Check for balanced begin/end (basic check)
  const begins = (tex.match(/\\begin\{/g) || []).length
  const ends = (tex.match(/\\end\{/g) || []).length
  if (begins !== ends) {
    warnings.push(`Unbalanced environments: ${begins} \\begin vs ${ends} \\end`)
  }

  const valid = tex.includes('\\begin{document}') && tex.includes('\\end{document}')
  return { valid, warnings }
}

/**
 * Apply a LaTeX update from the AI: sanitize and validate.
 * Returns the sanitized source, or the original if validation fails.
 */
export function applyLatexUpdate(originalTex: string, updatedTex: string): string {
  const sanitized = sanitizeLatex(updatedTex)

  const validation = validateLatex(sanitized)
  if (validation.warnings.length > 0) {
    console.warn('[LaTeX Editor] Warnings:', validation.warnings)
  }
  if (!validation.valid) {
    console.error('[LaTeX Editor] Invalid LaTeX after sanitization, keeping original')
    return originalTex
  }
  return sanitized
}

/**
 * Parse a LaTeX code block from AI response text.
 * Expected format:
 * ```latex
 * \documentclass{book}
 * ... complete LaTeX source ...
 * ```
 */
export function parseLatexBlock(responseText: string): string | null {
  const pattern = /```latex\n([\s\S]*?)```/
  const match = pattern.exec(responseText)
  if (!match) return null
  return match[1].trim()
}
