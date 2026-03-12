/**
 * Sanitize AI-generated HTML by stripping forbidden elements
 * instead of rejecting the entire edit.
 */
export function sanitizePageHTML(html: string): string {
  // Strip <script> tags and their contents
  let sanitized = html.replace(/<script[\s\S]*?<\/script>/gi, '')
  sanitized = sanitized.replace(/<script[^>]*\/>/gi, '')

  // Strip external URLs from src/href attributes (replace with empty string)
  // Allowed: /templates/, /uploads/, /api/, /fonts/, /images/, /thumbnails/, data:, #, ./
  const externalUrlPattern = /((?:src|href)=["'])(?!\/templates\/|\/uploads\/|\/api\/|\/fonts\/|\/images\/|\/thumbnails\/|data:|#|\.\/)(https?:\/\/[^"']*|\/\/[^"']*)(["'])/gi
  sanitized = sanitized.replace(externalUrlPattern, '$1$3')

  // Strip iframe, embed, object tags
  sanitized = sanitized.replace(/<(?:iframe|embed|object)[\s\S]*?(?:<\/(?:iframe|embed|object)>|\/?>)/gi, '')

  return sanitized
}

export function validatePageHTML(html: string): { valid: boolean; warnings: string[] } {
  const warnings: string[] = []

  // Ensure required .page wrapper div with data-page-number
  if (!html.includes('data-page-number=')) {
    warnings.push('Missing data-page-number attribute on page wrapper')
  }

  // Log if we had to strip scripts (for debugging)
  if (/<script[\s>]/i.test(html)) {
    warnings.push('Script tags were present (will be stripped)')
  }

  return {
    valid: html.includes('data-page-number='),
    warnings,
  }
}

export function applyPageUpdate(
  originalHtml: string,
  updatedHtml: string
): string {
  // Sanitize first — strip forbidden elements instead of rejecting
  const sanitized = sanitizePageHTML(updatedHtml)

  const validation = validatePageHTML(sanitized)
  if (validation.warnings.length > 0) {
    console.warn('[HTML Editor] Warnings:', validation.warnings)
  }
  if (!validation.valid) {
    console.error('[HTML Editor] Invalid HTML after sanitization, keeping original')
    return originalHtml
  }
  return sanitized
}

/**
 * Parse page-html code blocks from AI response text.
 * Expected format:
 * ```page-html:12
 * <!DOCTYPE html>
 * ... complete HTML ...
 * ```
 */
export function parsePageHtmlBlocks(
  responseText: string
): Record<number, string> {
  const pattern = /```page-html:(\d+)\n([\s\S]*?)```/g
  const result: Record<number, string> = {}

  let match: RegExpExecArray | null
  while ((match = pattern.exec(responseText)) !== null) {
    const pageNumber = parseInt(match[1], 10)
    const html = match[2].trim()
    result[pageNumber] = html
  }

  return result
}
