import OpenAI from 'openai'
import { callLLMWithTools, callLLM, generateImage } from './openrouter'
import { compileProject, readProjectFile, uploadProjectFile, uploadProjectImage } from '@/lib/latex/compiler'
import { createServiceClient } from '@/lib/supabase/server'
import { renderPdfPages, getPdfPageCount } from '@/lib/latex/pdf-to-image'
import { applyEdits, selfCorrectWithTool } from './latex-edit-tool'
import { sanitizeLatex, validateLatex } from './latex-editor'

export interface TaskEvent {
  type: 'status' | 'compile_start' | 'compile_done' | 'compile_error' | 'message' | 'done'
  message?: string
  error?: string
  pdfUrl?: string
}

export interface OrchestratorParams {
  projectId: string
  userMessage: string
  chatHistory: { role: 'user' | 'assistant' | 'system'; content: string }[]
  model?: string
  imageModel?: string
}

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Shluchim Exchange's AI assistant for a Hebrew/English Haggadah book creation platform.

You help users edit their LaTeX documents, generate images, and answer questions.

## When to use tools
- For text/layout/color changes: use the search_replace tool
- For creating new images/illustrations: use generate_image, then search_replace to insert it
- For questions or chat: just respond directly (no tools needed)

## search_replace rules
- The search text must be an EXACT substring that appears EXACTLY ONCE in the document.
- Include 5+ lines of surrounding context to ensure uniqueness — more context is always better.
- CRITICAL: The document has section markers like \`%%% ---- COVER PAGE ----\` and \`%%% ---- BACK COVER ----\`. The front and back covers have VERY similar content. ALWAYS include the nearest section marker in your search text. "Cover" or "front cover" = \`%%% ---- COVER PAGE ----\`, NOT the back cover.
- **ONLY change what was requested.** Your replacement text must be IDENTICAL to the search text except for the specific thing being changed. Do NOT modify, rename, remove, or replace \\\\includegraphics commands, image filenames, or any other content that the user did NOT ask you to change. If an \\\\includegraphics line appears in your search context, copy it EXACTLY into the replacement.
- You can call search_replace multiple times for multiple changes.
- Hebrew text is RTL — careful with \\\\beginR, \\\\endR, \\\\texthebrew{}.
- Do not remove \\\\usepackage declarations unless explicitly asked.
- Do NOT reference image filenames that are not already in the document or provided via [Uploaded:] or generate_image. Never invent filenames like "chabad-logo.png" — only use images that exist.

## Page overflow awareness
- Each page/section of this document has a fixed layout. When adding content (images, text, spacing), be careful not to push existing content onto the next page.
- For fixed-size sections like the cover page: if you add an image, you may need to REDUCE the size of other elements (ornaments, spacing, \\\\vspace) to keep everything on one page. Never just add content without considering the space it takes.
- If you use \\\\includegraphics, always include a size parameter like [width=2in] to control the image size.

## generate_image rules
- NEVER use TikZ, pgfplots, or LaTeX drawing commands for illustrations.
- Always use the generate_image tool, then insert with \\\\includegraphics via search_replace.
- Write a detailed prompt describing the desired image.

## File uploads
- \`[Uploaded: filename.png]\` → use exactly: \\\\includegraphics{images/filename.png}
- \`[File: name.txt]...[/File]\` → text file content between the tags

## Conversation history
- Use chat history to understand follow-up requests like "try again" or "undo that".
- Previous assistant messages may contain \`[Changes applied: ...]\` tags that describe exactly what was changed (generated images, edits made). Use this to know which files exist and what was done before. NEVER overwrite or rename files mentioned in prior changes unless the user explicitly asks.`

// ── Tool definitions ────────────────────────────────────────────────────────

const TOOL_DEFINITIONS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_replace',
      description:
        'Make a surgical edit to the LaTeX document. The search string must be an exact, unique substring. Include 5+ lines of context and section markers (e.g. %%% ---- COVER PAGE ----) to ensure uniqueness.',
      parameters: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Exact text to find in the document (must appear exactly once)',
          },
          replace: {
            type: 'string',
            description: 'The replacement text',
          },
          reason: {
            type: 'string',
            description: 'Brief explanation of the change',
          },
        },
        required: ['search', 'replace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description:
        'Generate an AI image. Returns the filename. After calling this, use search_replace to insert \\includegraphics{images/FILENAME} at the desired location.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed description of the image to generate',
          },
        },
        required: ['prompt'],
      },
    },
  },
]

const MAX_TOOL_ROUNDS = 10

// ── Main orchestrator ───────────────────────────────────────────────────────

export async function* runOrchestrator(
  params: OrchestratorParams
): AsyncGenerator<TaskEvent> {
  const supabase = createServiceClient()

  // Load project
  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', params.projectId)
    .single()

  if (!project) {
    yield { type: 'done', error: 'Project not found' }
    return
  }

  // Always load the document (no intent classification needed)
  yield { type: 'status', message: 'Loading your document...' }

  let doc = await readProjectFile(params.projectId, 'main.tex')

  if (!doc) {
    yield { type: 'done', error: 'No document found. Try creating a new project.' }
    return
  }

  // Migrate old split-file projects
  if (doc.includes('\\input{preamble}') && !doc.includes('\\usepackage')) {
    const assembled = await assembleOldProject(params.projectId, doc)
    if (!assembled) {
      yield { type: 'done', error: 'Could not read project files.' }
      return
    }
    doc = assembled
    await uploadProjectFile(params.projectId, 'main.tex', doc)
  }

  // Build messages for the LLM
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenAI message type union
  const messages: any[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...params.chatHistory.slice(-20).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    {
      role: 'user',
      content: `## Your LaTeX document:\n\`\`\`latex\n${doc}\n\`\`\`\n\n## Request: ${params.userMessage}`,
    },
  ]

  // ── Tool-calling loop ───────────────────────────────────────────────────

  let currentDoc = doc
  let documentChanged = false
  let aiReply = ''
  // Track changes for the changelog (persisted in chat history for future requests)
  const changeLog: string[] = []

  yield { type: 'status', message: 'Thinking...' }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callLLMWithTools(messages, TOOL_DEFINITIONS, {
      model: params.model,
    })

    // No tool calls → final response
    if (!response.tool_calls || response.tool_calls.length === 0) {
      aiReply = response.content || ''
      break
    }

    // Add assistant message (with tool calls) to conversation
    messages.push({
      role: 'assistant',
      content: response.content || null,
      tool_calls: response.tool_calls,
    })

    // Execute each tool call
    for (const tc of response.tool_calls) {
      // We only define function tools, so narrow the type
      const toolCall = tc as OpenAI.ChatCompletionMessageToolCall & { function: { name: string; arguments: string } }
      let toolResult: string

      if (toolCall.function.name === 'search_replace') {
        yield { type: 'status', message: 'Editing your document...' }
        try {
          const args = JSON.parse(toolCall.function.arguments)
          const { result, applied, failed } = applyEdits(currentDoc, [
            { search: args.search, replace: args.replace, reason: args.reason },
          ])

          if (applied.length > 0) {
            currentDoc = result
            documentChanged = true
            toolResult = 'Edit applied successfully.'
            changeLog.push(`edit: ${args.reason || args.replace.slice(0, 80)}`)
          } else {
            toolResult = `Edit FAILED: ${failed[0]?.error}. Try including more surrounding context in your search string, especially section markers like %%% ---- COVER PAGE ----.`
          }
        } catch (err) {
          toolResult = `Edit error: ${err instanceof Error ? err.message : 'Invalid arguments'}`
        }
      } else if (toolCall.function.name === 'generate_image') {
        yield { type: 'status', message: 'Generating an image...' }
        try {
          const args = JSON.parse(toolCall.function.arguments)
          const imageResult = await generateImage(args.prompt, params.imageModel)
          const filename = `gen-${Date.now()}.png`
          const buffer = Buffer.from(imageResult.b64, 'base64')
          await uploadProjectImage(params.projectId, filename, buffer)
          toolResult = `Image generated and saved as images/${filename}. Now use search_replace to insert \\includegraphics[width=3in]{images/${filename}} at the desired location in the document.`
          yield { type: 'message', message: `Image generated: ${filename}` }
          changeLog.push(`generated image: images/${filename}`)
        } catch (err) {
          toolResult = `Image generation failed: ${err instanceof Error ? err.message : 'Unknown error'}. Do NOT use TikZ or drawing commands as a fallback.`
          yield { type: 'message', message: `Image generation failed: ${err instanceof Error ? err.message : 'Unknown error'}` }
        }
      } else {
        toolResult = `Unknown tool: ${toolCall.function.name}`
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult,
      })
    }
  }

  // Fallback reply if the LLM never produced a final text response
  if (!aiReply && documentChanged) {
    aiReply = 'Your changes have been applied.'
  }

  // Show the AI's reply
  if (aiReply) {
    yield { type: 'message', message: aiReply }
  }

  // If no edits were made, just save the reply and done
  if (!documentChanged) {
    await supabase.from('messages').insert({
      project_id: params.projectId,
      role: 'assistant',
      content: aiReply || 'No changes were needed.',
    })
    yield { type: 'done', message: aiReply || 'No changes were needed.' }
    return
  }

  // Sanitize and validate the edited document
  const sanitized = sanitizeLatex(currentDoc)
  const validation = validateLatex(sanitized)

  if (!validation.valid) {
    console.error('[Orchestrator] Edits produced invalid LaTeX:', validation.warnings)
    yield {
      type: 'done',
      error: 'The edits produced invalid LaTeX. Please try a simpler request.',
    }
    return
  }

  currentDoc = sanitized
  console.log(`[Orchestrator] Document changed: ${doc.length} -> ${currentDoc.length} chars`)

  // Upload modified document
  yield { type: 'status', message: 'Saving changes...' }
  await uploadProjectFile(params.projectId, 'main.tex', currentDoc)

  // ── Compile with self-correction loop ─────────────────────────────────

  yield { type: 'compile_start', message: 'Building your book...' }
  await supabase.from('projects').update({ status: 'compiling' }).eq('id', params.projectId)

  let compileSuccess = false
  const maxRetries = 3

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await compileProject(params.projectId, currentDoc)

    if (result.success) {
      compileSuccess = true
      yield { type: 'compile_done', message: 'Your book is ready!' }
      break
    }

    // If the error is a storage/upload issue (not a LaTeX error), don't retry
    const isUploadError = result.errors?.some(e => e.includes('PDF upload failed'))
    if (isUploadError) {
      console.error(`[Orchestrator] PDF upload failed (storage limit?): ${result.errors?.join('; ')}`)
      yield {
        type: 'compile_error',
        error: 'The compiled PDF was too large to save. Try using smaller images or fewer pages.',
      }
      break
    }

    if (attempt < maxRetries) {
      console.log(`[Orchestrator] Compile failed attempt ${attempt}, errors: ${result.errors?.join('; ')}`)
      yield { type: 'message', message: `Fixing a compile issue (attempt ${attempt}/${maxRetries})...` }

      try {
        const beforeLen = currentDoc.length
        currentDoc = await selfCorrectWithTool({
          document: currentDoc,
          errors: result.errors ?? [],
          log: result.log ?? '',
          model: params.model,
        })
        console.log(`[Orchestrator] Self-correction: ${beforeLen} -> ${currentDoc.length} chars`)
        await uploadProjectFile(params.projectId, 'main.tex', currentDoc)
      } catch {
        // Self-correction failed, try compiling again
      }
    } else {
      // All compile attempts failed — revert to the original document
      console.warn(`[Orchestrator] All ${maxRetries} compile attempts failed, reverting document`)
      await uploadProjectFile(params.projectId, 'main.tex', doc)
      await supabase.from('projects').update({ status: 'ready' }).eq('id', params.projectId)

      yield {
        type: 'compile_error',
        error: `Compilation failed after ${maxRetries} attempts. Your document has been reverted to the last working version. Error: ${result.errors?.join('; ')}`,
      }
    }
  }

  // ── Post-compile PDF review ───────────────────────────────────────────

  let reviewNote = ''
  if (compileSuccess) {
    try {
      yield { type: 'status', message: 'Reviewing the output...' }
      const pdfReview = await reviewCompiledPdf({
        projectId: params.projectId,
        userMessage: params.userMessage,
        model: params.model,
      })

      if (pdfReview && !pdfReview.toLowerCase().includes('look good') && !pdfReview.toLowerCase().includes('looks good')) {
        console.warn(`[Orchestrator] Review detected issue: ${pdfReview}`)
        yield { type: 'status', message: 'Fixing a visual issue...' }

        try {
          // Use the in-memory document — NOT readProjectFile() which
          // can return stale data due to Supabase eventual consistency
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fixMessages: any[] = [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: `## Your LaTeX document:\n\`\`\`latex\n${currentDoc}\n\`\`\`\n\n## Fix this issue:\nThe previous edit was supposed to: "${params.userMessage}"\nBut the visual review found: "${pdfReview}"\nFix the problem now.`,
            },
          ]

          const fixResponse = await callLLMWithTools(fixMessages, TOOL_DEFINITIONS, {
            model: params.model,
            toolChoice: 'required',
          })

          let fixedDoc = currentDoc
          let fixApplied = false

          if (fixResponse.tool_calls) {
            for (const rawTc of fixResponse.tool_calls) {
              const tc = rawTc as OpenAI.ChatCompletionMessageToolCall & { function: { name: string; arguments: string } }
              if (tc.function.name === 'search_replace') {
                try {
                  const args = JSON.parse(tc.function.arguments)
                  const { result, applied } = applyEdits(fixedDoc, [
                    { search: args.search, replace: args.replace },
                  ])
                  if (applied.length > 0) {
                    fixedDoc = result
                    fixApplied = true
                  }
                } catch {
                  // skip malformed tool call
                }
              }
            }
          }

          if (fixApplied && fixedDoc !== currentDoc) {
            const sanitizedFix = sanitizeLatex(fixedDoc)
            await uploadProjectFile(params.projectId, 'main.tex', sanitizedFix)
            const fixCompile = await compileProject(params.projectId, sanitizedFix)
            if (fixCompile.success) {
              currentDoc = sanitizedFix
              yield { type: 'compile_done', message: 'Fixed and recompiled!' }
            } else {
              reviewNote = '\n\n' + pdfReview
            }
          } else {
            reviewNote = '\n\n' + pdfReview
          }
        } catch (fixErr) {
          const msg = fixErr instanceof Error ? fixErr.message : String(fixErr)
          console.error(`[Orchestrator] Review fix failed: ${msg}`)
          reviewNote = '\n\n' + pdfReview
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[Orchestrator] PDF review failed: ${msg}`)
      // Review failure is non-fatal — the edit+compile already succeeded
    }
  }

  // Save assistant message — if the review found an issue, replace the AI's
  // original reply to avoid contradictory messaging ("I changed it" + "it wasn't changed")
  const compileNote = compileSuccess
    ? ''
    : '\n\n(Compilation failed — your document has been reverted to the last working version. Please try a simpler edit.)'
  let finalReply = aiReply || 'Your changes have been applied.'
  if (reviewNote) {
    finalReply = `I attempted the changes, but the visual review found an issue: ${reviewNote.trim()}`
  }

  // Build the saved message: user-visible reply + hidden changelog for future context
  // The changelog is formatted so the AI in future requests knows exactly what was done
  const changeLogSection = changeLog.length > 0
    ? `\n\n[Changes applied: ${changeLog.join('; ')}]`
    : ''
  const summary = finalReply + compileNote + changeLogSection

  await supabase.from('messages').insert({
    project_id: params.projectId,
    role: 'assistant',
    content: summary,
  })

  yield { type: 'done', message: summary }
}

// ── PDF visual review ─────────────────────────────────────────────────────

async function reviewCompiledPdf(params: {
  projectId: string
  userMessage: string
  model?: string
}): Promise<string | null> {
  const supabase = createServiceClient()

  const { data: project } = await supabase
    .from('projects')
    .select('pdf_path')
    .eq('id', params.projectId)
    .single()

  if (!project?.pdf_path) return null

  const { data: pdfBlob, error } = await supabase.storage
    .from('projects')
    .download(project.pdf_path)

  if (error || !pdfBlob) return null

  const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer())

  let totalPages = 0
  try {
    totalPages = await getPdfPageCount(pdfBuffer)
  } catch {
    totalPages = 40
  }

  // Ask the AI which pages to check
  let pagesToRender: number[]
  try {
    const pagePickResponse = await callLLM(
      [
        {
          role: 'system' as const,
          content: `You pick which PDF pages to visually review after an edit. The PDF has ${totalPages} pages. Return ONLY a JSON array of 3-5 page numbers, e.g. [1, 3, 7]. Always include page 1 and the last page.

Common reference: Cover=page 1, TOC~page 3, Kadesh~page 5, Maggid~page 7, Hallel/Nirtzah near end.`,
        },
        {
          role: 'user' as const,
          content: `Edit request: "${params.userMessage}"\nWhich pages should I render? Return ONLY a JSON array.`,
        },
      ],
      { model: params.model, maxTokens: 64, temperature: 0.1 }
    )

    const match = pagePickResponse.match(/\[[\d\s,]+\]/)
    if (match) {
      pagesToRender = JSON.parse(match[0])
        .filter((n: number) => n >= 1 && n <= totalPages)
        .slice(0, 6)
    } else {
      pagesToRender = [1, Math.ceil(totalPages / 2), totalPages]
    }
  } catch {
    pagesToRender = [1, Math.ceil(totalPages / 2), totalPages]
  }

  if (!pagesToRender.includes(1)) pagesToRender.unshift(1)
  pagesToRender = Array.from(new Set(pagesToRender)).sort((a, b) => a - b).slice(0, 6)

  console.log(`[AI Review] PDF has ${totalPages} pages, inspecting: ${pagesToRender.join(', ')}`)

  const pages = await renderPdfPages(pdfBuffer, pagesToRender, 150)
  if (pages.length === 0) return null

  const imageContent = pages.map(p => ({
    type: 'image_url' as const,
    image_url: { url: `data:image/png;base64,${p.base64}` },
  }))

  const reviewMessages = [
    {
      role: 'system' as const,
      content: `You are the visual QA reviewer for Shluchim Exchange. Check the rendered PDF pages against the user's request.

The user asked: "${params.userMessage}"

Be strict:
- ADD IMAGE: Is a new image/illustration ACTUALLY VISIBLE? Not just text.
- CHANGE COLOR: Is the color actually different from the standard blue/gold theme?
- ADD TEXT: Is the new text actually visible?
- Check for: text overflow, garbled Hebrew, blank pages, layout issues.

If you see a problem, describe it in 1-2 sentences. If everything looks correct, say "Pages look good."`,
    },
    {
      role: 'user' as const,
      content: [
        {
          type: 'text' as const,
          text: `Here are ${pages.length} rendered pages (pages ${pages.map(p => p.page).join(', ')}). Verify the edit looks right.`,
        },
        ...imageContent,
      ],
    },
  ]

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await callLLM(reviewMessages as any, {
      model: params.model,
      maxTokens: 512,
      temperature: 0.2,
    })
  } catch (err) {
    console.warn('[AI] PDF review failed:', err)
    return null
  }
}

// ── Migration helper for old split-file projects ──────────────────────────

async function assembleOldProject(projectId: string, mainTex: string): Promise<string | null> {
  const preamble = await readProjectFile(projectId, 'preamble.tex')
  if (!preamble) return null

  const pagePattern = /\\input\{pages\/(page-\d+)\}/g
  const pageFiles: string[] = []
  let match
  while ((match = pagePattern.exec(mainTex)) !== null) {
    pageFiles.push(match[1])
  }

  const pageContents: string[] = []
  for (const pageFile of pageFiles) {
    const content = await readProjectFile(projectId, `pages/${pageFile}.tex`)
    if (content) pageContents.push(content)
  }

  return `\\documentclass[11pt, openany]{book}

${preamble}

\\begin{document}

${pageContents.join('\n\n')}

\\end{document}
`
}
