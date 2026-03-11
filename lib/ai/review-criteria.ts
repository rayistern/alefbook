export const REVIEW_CRITERIA = `
Review the rendered page image against these criteria. For each issue found,
describe it specifically (which element, what the problem is, how to fix it).

LAYOUT:
- No text overflows its container (check for cut-off words at edges)
- No text is within 5px of any page edge (safe zone)
- No two elements overlap unintentionally
- Spacing is visually balanced
- Bleed area (outer 18px) contains only background fills, never text

TYPOGRAPHY:
- Hebrew text renders with nikud visible and not clipped
- Hebrew text is right-to-left
- Minimum body text size is 10pt equivalent
- No missing font / tofu boxes
- Hebrew line-height is sufficient for nikud (minimum 1.6x)

IMAGES:
- Photo fills slot with no white gaps
- Photo is not stretched (object-fit: cover)
- No important subject clipped at edges

DESIGN:
- Color contrast is sufficient for readability
- New elements are consistent with surrounding page style
- The page looks intentional, not like a layout error

OUTPUT — respond ONLY with JSON:
{
  "passed": true | false,
  "issues": ["specific issue 1", "specific issue 2"],
  "feedback_for_next_pass": "what to fix and how"
}
`

export interface ReviewResult {
  passed: boolean
  issues: string[]
  feedback: string | null
}
