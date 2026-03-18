/**
 * Direct test script for the edit pipeline.
 * Reads a project's main.tex from Supabase, runs an edit, checks the result.
 *
 * Usage: npx tsx scripts/test-edit.ts
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PROJECT_ID = process.argv[2] || '52158422-d348-4320-8709-8b82b9336484'

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  // 1. Read main.tex
  console.log(`\n=== Reading main.tex for project ${PROJECT_ID} ===`)
  const { data: texBlob, error: dlErr } = await supabase.storage
    .from('projects')
    .download(`projects/${PROJECT_ID}/main.tex`)

  if (dlErr || !texBlob) {
    console.error('Failed to download main.tex:', dlErr)
    process.exit(1)
  }

  const document = await texBlob.text()
  console.log(`Document: ${document.length} chars`)

  // 2. Check for cover section
  const coverIdx = document.indexOf('%%% ---- COVER PAGE ----')
  console.log(`Cover section at char ${coverIdx}`)

  const ornament1 = document.indexOf('\\pgfornament[width=3.5cm]{75}')
  const ornament2 = document.indexOf('\\pgfornament[width=3.5cm, symmetry=h]{75}')
  console.log(`First ornament at char ${ornament1}`)
  console.log(`Second ornament at char ${ornament2}`)

  // 3. Check for any existing \includegraphics
  const includeMatches = document.match(/\\includegraphics[^}]*\{[^}]+\}/g) || []
  console.log(`\n=== Existing \\includegraphics calls: ${includeMatches.length} ===`)
  includeMatches.forEach(m => console.log(`  ${m}`))

  // 4. Test the edit function directly
  console.log(`\n=== Testing editDocumentWithTool ===`)
  const { editDocumentWithTool } = await import('../lib/ai/latex-edit-tool')

  const result = await editDocumentWithTool({
    currentDocument: document,
    instruction: 'Add "HELLO WORLD" in big white text to the front cover, between the lower ornament and "Your Chabad House".',
    chatHistory: [],
  })

  console.log(`\n=== Edit result ===`)
  console.log(`Reply: ${result.reply}`)
  console.log(`Edits applied: ${result.edits.length}`)
  console.log(`Edits failed: ${result.failedEdits.length}`)

  const docChanged = result.latex !== document
  console.log(`Document changed: ${docChanged}`)
  console.log(`New length: ${result.latex.length} (was ${document.length})`)

  // 5. Check if the edit is in the result
  const hasHelloWorld = result.latex.includes('HELLO WORLD')
  console.log(`Contains "HELLO WORLD": ${hasHelloWorld}`)

  if (docChanged) {
    // Find the diff
    for (let i = 0; i < Math.min(document.length, result.latex.length); i++) {
      if (document[i] !== result.latex[i]) {
        const context = 100
        console.log(`\n=== First difference at char ${i} ===`)
        console.log(`BEFORE: ...${document.slice(Math.max(0, i-context), i+context)}...`)
        console.log(`AFTER:  ...${result.latex.slice(Math.max(0, i-context), i+context)}...`)
        break
      }
    }
  }

  // 6. Check \includegraphics in the result
  const newIncludes = result.latex.match(/\\includegraphics[^}]*\{[^}]+\}/g) || []
  console.log(`\n=== \\includegraphics after edit: ${newIncludes.length} ===`)
  newIncludes.forEach(m => console.log(`  ${m}`))

  // 7. List images in storage
  console.log(`\n=== Images in storage ===`)
  const { data: imgFiles } = await supabase.storage
    .from('projects')
    .list(`projects/${PROJECT_ID}/images`)
  console.log(`Images: ${imgFiles?.map(f => f.name).join(', ') || 'none'}`)

  console.log(`\n=== DONE ===`)
}

main().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
