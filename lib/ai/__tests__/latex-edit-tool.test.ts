import { describe, it, expect } from 'vitest'
import { parseSearchReplaceBlocks, applyEdits } from '../latex-edit-tool'

// ── parseSearchReplaceBlocks ────────────────────────────────────────────────

describe('parseSearchReplaceBlocks', () => {
  it('parses a single SEARCH/REPLACE block', () => {
    const response = `Here is the change.

<<<SEARCH
\\textbf{Hello}
>>>
<<<REPLACE
\\textbf{World}
>>>`

    const { reply, edits } = parseSearchReplaceBlocks(response)
    expect(edits).toHaveLength(1)
    expect(edits[0].search).toBe('\\textbf{Hello}')
    expect(edits[0].replace).toBe('\\textbf{World}')
    expect(reply).toBe('Here is the change.')
  })

  it('parses multiple SEARCH/REPLACE blocks', () => {
    const response = `<<<SEARCH
line one
>>>
<<<REPLACE
LINE ONE
>>>
<<<SEARCH
line two
>>>
<<<REPLACE
LINE TWO
>>>`

    const { edits } = parseSearchReplaceBlocks(response)
    expect(edits).toHaveLength(2)
    expect(edits[0].search).toBe('line one')
    expect(edits[0].replace).toBe('LINE ONE')
    expect(edits[1].search).toBe('line two')
    expect(edits[1].replace).toBe('LINE TWO')
  })

  it('extracts reply text before blocks', () => {
    const response = `I changed the title to "World".

<<<SEARCH
\\textbf{Hello}
>>>
<<<REPLACE
\\textbf{World}
>>>`

    const { reply, edits } = parseSearchReplaceBlocks(response)
    expect(reply).toBe('I changed the title to "World".')
    expect(edits).toHaveLength(1)
  })

  it('returns the entire response as reply when there are no blocks', () => {
    const response = 'The document looks good. No changes needed.'

    const { reply, edits } = parseSearchReplaceBlocks(response)
    expect(reply).toBe('The document looks good. No changes needed.')
    expect(edits).toHaveLength(0)
  })

  it('handles empty search string', () => {
    const response = `<<<SEARCH

>>>
<<<REPLACE
new content
>>>`

    const { edits } = parseSearchReplaceBlocks(response)
    expect(edits).toHaveLength(1)
    expect(edits[0].search).toBe('')
    expect(edits[0].replace).toBe('new content')
  })

  it('handles empty replace string (deletion)', () => {
    const response = `<<<SEARCH
remove this line
>>>
<<<REPLACE

>>>`

    const { edits } = parseSearchReplaceBlocks(response)
    expect(edits).toHaveLength(1)
    expect(edits[0].search).toBe('remove this line')
    expect(edits[0].replace).toBe('')
  })

  it('handles blocks with newlines in content', () => {
    const response = `<<<SEARCH
\\begin{itemize}
  \\item First
  \\item Second
\\end{itemize}
>>>
<<<REPLACE
\\begin{enumerate}
  \\item First
  \\item Second
  \\item Third
\\end{enumerate}
>>>`

    const { edits } = parseSearchReplaceBlocks(response)
    expect(edits).toHaveLength(1)
    expect(edits[0].search).toBe(
      '\\begin{itemize}\n  \\item First\n  \\item Second\n\\end{itemize}'
    )
    expect(edits[0].replace).toBe(
      '\\begin{enumerate}\n  \\item First\n  \\item Second\n  \\item Third\n\\end{enumerate}'
    )
  })

  it('handles multi-line reply text before blocks', () => {
    const response = `I made two changes:
1. Changed the title
2. Added a new section

<<<SEARCH
old title
>>>
<<<REPLACE
new title
>>>`

    const { reply, edits } = parseSearchReplaceBlocks(response)
    expect(reply).toBe('I made two changes:\n1. Changed the title\n2. Added a new section')
    expect(edits).toHaveLength(1)
  })

  it('trims trailing newline from captured search and replace', () => {
    // The regex captures content between markers; trailing \n from the
    // capture group is stripped by .replace(/\n$/, '')
    const response = `<<<SEARCH
alpha
>>>
<<<REPLACE
beta
>>>`

    const { edits } = parseSearchReplaceBlocks(response)
    expect(edits[0].search).toBe('alpha')
    expect(edits[0].replace).toBe('beta')
    // Ensure no trailing newline
    expect(edits[0].search.endsWith('\n')).toBe(false)
    expect(edits[0].replace.endsWith('\n')).toBe(false)
  })
})

// ── applyEdits ──────────────────────────────────────────────────────────────

describe('applyEdits', () => {
  it('applies a single edit that matches exactly once', () => {
    const doc = 'Hello, World!'
    const edits = [{ search: 'World', replace: 'Universe' }]

    const { result, applied, failed } = applyEdits(doc, edits)
    expect(result).toBe('Hello, Universe!')
    expect(applied).toHaveLength(1)
    expect(failed).toHaveLength(0)
  })

  it('fails when search string appears 0 times', () => {
    const doc = 'Hello, World!'
    const edits = [{ search: 'Goodbye', replace: 'Hi' }]

    const { result, applied, failed } = applyEdits(doc, edits)
    expect(result).toBe('Hello, World!')
    expect(applied).toHaveLength(0)
    expect(failed).toHaveLength(1)
    expect(failed[0].error).toBe('Search string not found in document')
  })

  it('fails when search string appears 2+ times with "must be unique" message', () => {
    const doc = 'abc abc abc'
    const edits = [{ search: 'abc', replace: 'xyz' }]

    const { result, applied, failed } = applyEdits(doc, edits)
    expect(result).toBe('abc abc abc') // unchanged
    expect(applied).toHaveLength(0)
    expect(failed).toHaveLength(1)
    expect(failed[0].error).toContain('must be unique')
    expect(failed[0].error).toContain('3 times')
  })

  it('handles multiple edits where some succeed and some fail', () => {
    const doc = 'The quick brown fox jumps over the lazy dog'
    const edits = [
      { search: 'quick brown', replace: 'slow red' },     // will succeed
      { search: 'missing text', replace: 'nope' },         // will fail (not found)
      { search: 'lazy dog', replace: 'energetic cat' },    // will succeed
    ]

    const { result, applied, failed } = applyEdits(doc, edits)
    expect(result).toBe('The slow red fox jumps over the energetic cat')
    expect(applied).toHaveLength(2)
    expect(failed).toHaveLength(1)
    expect(failed[0].edit.search).toBe('missing text')
  })

  it('returns original document for empty edits array', () => {
    const doc = 'unchanged document'
    const { result, applied, failed } = applyEdits(doc, [])
    expect(result).toBe('unchanged document')
    expect(applied).toHaveLength(0)
    expect(failed).toHaveLength(0)
  })

  it('applies edits sequentially so later edits see earlier changes', () => {
    const doc = 'AAA BBB CCC'
    const edits = [
      { search: 'AAA', replace: 'XXX' },
      { search: 'XXX BBB', replace: 'YYY' }, // depends on first edit having been applied
    ]

    const { result, applied, failed } = applyEdits(doc, edits)
    expect(result).toBe('YYY CCC')
    expect(applied).toHaveLength(2)
    expect(failed).toHaveLength(0)
  })

  it('fuzzy matches after trimming trailing whitespace per line', () => {
    // Document has trailing spaces on lines
    const doc = 'line one   \nline two  \nline three'
    // Search string without trailing spaces (as LLM might produce)
    const edits = [{ search: 'line one\nline two', replace: 'LINE ONE\nLINE TWO' }]

    const { result, applied, failed } = applyEdits(doc, edits)
    expect(applied).toHaveLength(1)
    expect(failed).toHaveLength(0)
    expect(result).toContain('LINE ONE')
    expect(result).toContain('LINE TWO')
    expect(result).toContain('line three')
  })

  it('fuzzy match fails when normalized search is still not unique', () => {
    // Both occurrences would normalize to the same thing
    const doc = 'hello   \nworld\nhello  \nworld'
    const edits = [{ search: 'hello\nworld', replace: 'REPLACED' }]

    const { result, applied, failed } = applyEdits(doc, edits)
    // fuzzyReplace should return null because there are 2 matches after normalization
    expect(result).toBe('hello   \nworld\nhello  \nworld')
    expect(applied).toHaveLength(0)
    expect(failed).toHaveLength(1)
    expect(failed[0].error).toBe('Search string not found in document')
  })

  it('handles multi-line search and replace', () => {
    const doc = `\\begin{document}
\\section{Introduction}
This is the intro.
\\end{document}`

    const edits = [{
      search: '\\section{Introduction}\nThis is the intro.',
      replace: '\\section{Overview}\nThis is the overview paragraph.',
    }]

    const { result, applied, failed } = applyEdits(doc, edits)
    expect(applied).toHaveLength(1)
    expect(failed).toHaveLength(0)
    expect(result).toContain('\\section{Overview}')
    expect(result).toContain('This is the overview paragraph.')
    expect(result).toContain('\\begin{document}')
    expect(result).toContain('\\end{document}')
  })

  it('reports the correct count for duplicate occurrences', () => {
    const doc = 'x x'
    const edits = [{ search: 'x', replace: 'y' }]

    const { failed } = applyEdits(doc, edits)
    expect(failed).toHaveLength(1)
    expect(failed[0].error).toContain('2 times')
  })

  it('preserves failed edit object in the failure record', () => {
    const doc = 'some text'
    const edit = { search: 'not here', replace: 'nope', reason: 'testing' }
    const { failed } = applyEdits(doc, [edit])

    expect(failed).toHaveLength(1)
    expect(failed[0].edit).toBe(edit)
    expect(failed[0].edit.reason).toBe('testing')
  })
})
