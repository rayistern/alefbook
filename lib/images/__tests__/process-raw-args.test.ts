import { describe, it, expect } from 'vitest'
import { assertSafeRawArgs } from '../process'

/**
 * Tests for the AI-composed raw ImageMagick argument validator.
 *
 * The `imagemagick` orchestrator tool lets the LLM compose arbitrary
 * `convert`-style arguments (see lib/ai/orchestrator.ts). These tests pin
 * down two things:
 *   1. every documented/legitimate usage from the tool's own prompt examples
 *      keeps working, and
 *   2. the ImageMagick-native file-read/write/script vectors (the actual
 *      threat, since execFile already prevents shell interpretation) are
 *      rejected.
 */
describe('assertSafeRawArgs', () => {
  // --- Legitimate arg lists (from the orchestrator prompt examples) ---

  it('allows the documented feathering example', () => {
    expect(() => assertSafeRawArgs(['-alpha', 'set', '-vignette', '0x3'])).not.toThrow()
  })

  it('allows the documented morphology/clone example with parentheses', () => {
    expect(() =>
      assertSafeRawArgs([
        '-alpha', 'set',
        '(', '+clone', '-channel', 'A', '-morphology', 'Erode', 'Disk:2', '+channel', ')',
        '-compose', 'DstIn', '-composite',
      ])
    ).not.toThrow()
  })

  it('allows grayscale and resize examples', () => {
    expect(() => assertSafeRawArgs(['-colorspace', 'Gray'])).not.toThrow()
    expect(() => assertSafeRawArgs(['-resize', '400x'])).not.toThrow()
  })

  it('allows literal-text label/caption coders (no @ indirection)', () => {
    // label:/caption: with literal strings are legitimate captioning tools;
    // only their @file form reads files, and that is blocked separately.
    expect(() => assertSafeRawArgs(['label:Hello World', '-gravity', 'south'])).not.toThrow()
  })

  // --- Pre-existing protections (kept from the original inline check) ---

  it('rejects path traversal', () => {
    expect(() => assertSafeRawArgs(['../../etc/passwd'])).toThrow(/rejected/)
  })

  it('rejects absolute paths', () => {
    expect(() => assertSafeRawArgs(['/etc/passwd'])).toThrow(/rejected/)
  })

  it('rejects shell metacharacters', () => {
    expect(() => assertSafeRawArgs(['foo;rm -rf'])).toThrow(/rejected/)
    expect(() => assertSafeRawArgs(['$(whoami)'])).toThrow(/rejected/)
    expect(() => assertSafeRawArgs(['`id`'])).toThrow(/rejected/)
  })

  // --- New protections: ImageMagick-native file access ---

  it('rejects @-file indirection in any position', () => {
    // caption:@file reads arbitrary files into the rendered output.
    expect(() => assertSafeRawArgs(['caption:@secrets.txt'])).toThrow(/@-file/)
    // -draw with @file reads a drawing-commands file.
    expect(() => assertSafeRawArgs(['-draw', 'text 0,0 @notes.txt'])).toThrow(/@-file/)
    // -set option arguments can also use @ indirection.
    expect(() => assertSafeRawArgs(['-set', 'comment', '@log.txt'])).toThrow(/@-file/)
  })

  it('rejects -write / +write mid-pipeline output', () => {
    expect(() => assertSafeRawArgs(['-write', 'stolen.png'])).toThrow(/file\/script output/)
    expect(() => assertSafeRawArgs(['+write', 'stolen.png'])).toThrow(/file\/script output/)
  })

  it('rejects -script and -process', () => {
    expect(() => assertSafeRawArgs(['-script', 'evil.msl'])).toThrow(/file\/script output/)
    expect(() => assertSafeRawArgs(['-process', 'module'])).toThrow(/file\/script output/)
  })

  it('rejects script/system-resource coder prefixes', () => {
    expect(() => assertSafeRawArgs(['msl:script.msl'])).toThrow(/forbidden coder/)
    expect(() => assertSafeRawArgs(['inline:data'])).toThrow(/forbidden coder/)
    expect(() => assertSafeRawArgs(['fd:3'])).toThrow(/forbidden coder/)
    expect(() => assertSafeRawArgs(['x:root'])).toThrow(/forbidden coder/)
    expect(() => assertSafeRawArgs(['clipboard:'])).toThrow(/forbidden coder/)
    expect(() => assertSafeRawArgs(['https:evil.example'])).toThrow(/forbidden coder/)
  })

  it('reports the offending argument in the error message', () => {
    expect(() => assertSafeRawArgs(['-resize', '400x', 'caption:@x'])).toThrow('caption:@x')
  })
})
