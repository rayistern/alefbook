export function validatePageHTML(html: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Ensure required .page wrapper div with data-page-number
  if (!html.includes('data-page-number=')) {
    errors.push('Missing data-page-number attribute on page wrapper')
  }

  // No scripts injected
  if (/<script[\s>]/i.test(html)) {
    errors.push('Script tags are not allowed in page HTML')
  }

  // No external resource URLs (only local paths and data: URIs allowed)
  const urlPattern = /(?:src|href)=["'](?!\/templates\/|\/uploads\/|\/api\/|\/fonts\/|\/images\/|\/thumbnails\/|data:|#|\.\/)/gi
  if (urlPattern.test(html)) {
    errors.push('External resource URLs are not allowed — use only /templates/, /uploads/, or data: URIs')
  }

  // Check page dimensions are referenced (540px page within 576px with bleed)
  // This is a soft check — the AI should maintain the page dimensions
  if (!html.includes('540px') && !html.includes('540')) {
    // Only warn, don't fail — some pages might use different unit systems
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function applyPageUpdate(
  originalHtml: string,
  updatedHtml: string
): string {
  const validation = validatePageHTML(updatedHtml)
  if (!validation.valid) {
    console.error('AI returned invalid HTML:', validation.errors)
    return originalHtml // fall back to original, don't corrupt the page
  }
  return updatedHtml
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
