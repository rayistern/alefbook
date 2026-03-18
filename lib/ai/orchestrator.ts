import { callLLM } from './openrouter'
import { compileProject, readProjectFile, uploadProjectFile } from '@/lib/latex/compiler'
import { createServiceClient } from '@/lib/supabase/server'
import { renderPdfPages, getPdfPageCount } from '@/lib/latex/pdf-to-image'
import { editDocumentWithTool, selfCorrectWithTool } from './latex-edit-tool'

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

const INTENT_MODEL = 'openai/gpt-5.1-codex-mini'

/**
 * Route user messages to the right handler using a cheap LLM call.
 * - "chat": simple messages, greetings, questions → quick LLM reply, no doc loading
 * - "question": questions about the document → load doc, answer, no compile
 * - "edit": edit requests → load doc, edit, compile
 * - "image": image generation requests → generate image + edit doc + compile
 */
async function classifyIntent(message: string): Promise<'chat' | 'question' | 'edit' | 'image'> {
  const msg = message.toLowerCase().trim()

  // File attachments always route to edit (user is providing content)
  if (msg.includes('[file:') || msg.includes('[uploaded:')) {
    return 'edit'
  }

  try {
    const response = await callLLM(
      [
        {
          role: 'system',
          content: `Classify the user message into exactly one category. Return ONLY the label, nothing else.

- chat: greetings, thanks, small talk, off-topic conversation
- question: asking about the document content without requesting changes
- edit: requesting text/color/layout changes to the document (NOT images)
- image: the user wants a NEW image/picture/illustration/photo created or generated and added to the document. Key words: "picture of", "image of", "illustration of", "draw", "generate", "create an image", "add a picture/photo/image of". Even if they also want it placed somewhere, classify as image.`,
        },
        { role: 'user', content: message },
      ],
      { model: INTENT_MODEL, maxTokens: 16, temperature: 0 }
    )

    // Extract just the label — model might return extra text or punctuation
    const raw = response.trim().toLowerCase().replace(/[^a-z]/g, '')
    const label = (['image', 'chat', 'question', 'edit'] as const).find(l => raw.startsWith(l))
    console.log(`[Intent] "${message.slice(0, 60)}" → raw="${response.trim()}" → ${label || 'edit (fallback)'}`)
    return label || 'edit'
  } catch (err) {
    console.warn('[Intent] Classification failed, defaulting to edit:', err)
    return 'edit'
  }
}

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

  const intent = await classifyIntent(params.userMessage)

  // --- CHAT: quick reply, no document needed ---
  if (intent === 'chat') {
    const reply = await quickChat({
      message: params.userMessage,
      chatHistory: params.chatHistory,
      model: params.model,
    })

    await supabase.from('messages').insert({
      project_id: params.projectId,
      role: 'assistant',
      content: reply,
    })

    yield { type: 'done', message: reply }
    return
  }

  // --- QUESTION, EDIT, or IMAGE: need to load the document ---
  yield { type: 'status', message: 'Loading your document...' }

  let document = await readProjectFile(params.projectId, 'main.tex')

  if (!document) {
    yield { type: 'done', error: 'No document found. Try creating a new project.' }
    return
  }

  // Migrate old split-file projects
  if (document.includes('\\input{preamble}') && !document.includes('\\usepackage')) {
    document = await assembleOldProject(params.projectId, document)
    if (document) {
      await uploadProjectFile(params.projectId, 'main.tex', document)
    } else {
      yield { type: 'done', error: 'Could not read project files.' }
      return
    }
  }

  // --- QUESTION: answer about the doc, no edit/compile ---
  if (intent === 'question') {
    const reply = await answerQuestion({
      document,
      message: params.userMessage,
      chatHistory: params.chatHistory,
      model: params.model,
    })

    await supabase.from('messages').insert({
      project_id: params.projectId,
      role: 'assistant',
      content: reply,
    })

    yield { type: 'done', message: reply }
    return
  }

  // --- EDIT (or IMAGE): full edit + compile loop ---
  let imageFilename: string | null = null

  if (intent === 'image') {
    yield { type: 'status', message: 'Generating an image...' }
    try {
      imageFilename = await handleImageGeneration({
        projectId: params.projectId,
        instruction: params.userMessage,
        imageModel: params.imageModel,
      })
      yield { type: 'message', message: `Image generated: ${imageFilename}` }
    } catch (err) {
      yield { type: 'message', message: `Image generation failed: ${err instanceof Error ? err.message : 'Unknown error'}. Continuing with edit.` }
    }
  }

  yield { type: 'status', message: 'Editing your document...' }

  let editInstruction: string
  if (imageFilename) {
    editInstruction = `${params.userMessage}\n\n[System: An image has been generated and saved as images/${imageFilename}. You MUST insert it using EXACTLY this command: \\includegraphics[width=3in]{images/${imageFilename}} — do NOT use TikZ, pgfplots, tikzpicture, or any drawing commands. Use \\includegraphics ONLY. Place it at the appropriate location in the document.]`
  } else if (intent === 'image') {
    editInstruction = `${params.userMessage}\n\n[System: Image generation was attempted but failed. Do NOT try to create the image with TikZ or any LaTeX drawing commands. Just make any other requested text/formatting edits and let the user know the image could not be generated.]`
  } else {
    editInstruction = params.userMessage
  }

  let editResult
  try {
    editResult = await editDocumentWithTool({
      currentDocument: document,
      instruction: editInstruction,
      chatHistory: params.chatHistory,
      model: params.model,
    })
  } catch (err) {
    yield { type: 'done', error: `Edit failed: ${err instanceof Error ? err.message : 'Unknown error'}` }
    return
  }

  let { latex: edited, reply: aiReply } = editResult
  const { edits, failedEdits } = editResult

  // Post-edit verification: if an image was generated, make sure \includegraphics actually appears
  if (imageFilename && !edited.includes(`\\includegraphics`) || (imageFilename && !edited.includes(imageFilename))) {
    console.warn(`[Orchestrator] Image ${imageFilename} not found in edited document via \\includegraphics — retrying with forced insertion`)
    try {
      const retryResult = await editDocumentWithTool({
        currentDocument: edited,
        instruction: `[System: CRITICAL — The previous edit did NOT insert the image. You MUST add this EXACT line: \\includegraphics[width=3in]{images/${imageFilename}} — place it where the user requested ("${params.userMessage}"). Use a SEARCH/REPLACE block to find the right location and insert ONLY \\includegraphics. Do NOT use TikZ or any drawing commands.]`,
        chatHistory: [],
        model: params.model,
      })
      if (retryResult.latex.includes(imageFilename) && retryResult.edits.length > 0) {
        edited = retryResult.latex
        aiReply = (aiReply || '') + '\n\n(Image placement was corrected.)'
        console.log(`[Orchestrator] Image insertion retry succeeded`)
      }
    } catch (err) {
      console.warn(`[Orchestrator] Image insertion retry failed:`, err)
    }
  }

  // Show the AI's conversational reply immediately
  if (aiReply) {
    yield { type: 'message', message: aiReply }
  }

  // If the LLM didn't produce any edits (just a conversational reply), skip compile
  if (edits.length === 0 && failedEdits.length === 0) {
    await supabase.from('messages').insert({
      project_id: params.projectId,
      role: 'assistant',
      content: aiReply || 'No changes were needed.',
    })
    yield { type: 'done', message: aiReply || 'No changes were needed.' }
    return
  }

  console.log(`[Orchestrator] Applied ${edits.length} edits, ${failedEdits.length} failed`)
  const docChanged = edited !== document
  console.log(`[Orchestrator] Document changed: ${docChanged}, original: ${document.length} chars, edited: ${edited.length} chars`)
  if (!docChanged && edits.length > 0) {
    console.error(`[Orchestrator] BUG: ${edits.length} edits reported as applied but document is UNCHANGED!`)
  }

  // Upload modified document
  yield { type: 'status', message: 'Saving changes...' }
  await uploadProjectFile(params.projectId, 'main.tex', edited)

  // Compile with self-correction loop
  yield { type: 'compile_start', message: 'Building your book...' }
  await supabase.from('projects').update({ status: 'compiling' }).eq('id', params.projectId)

  let compileSuccess = false
  let currentDoc = edited
  const maxRetries = 3

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await compileProject(params.projectId)

    if (result.success) {
      compileSuccess = true
      yield { type: 'compile_done', message: 'Your book is ready!' }
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
        console.log(`[Orchestrator] Self-correction: ${beforeLen} → ${currentDoc.length} chars`)
        // Check if self-correction removed any \includegraphics
        if (beforeLen > currentDoc.length && !currentDoc.includes('\\includegraphics') && edited.includes('\\includegraphics')) {
          console.error(`[Orchestrator] WARNING: Self-correction removed \\includegraphics!`)
        }
        await uploadProjectFile(params.projectId, 'main.tex', currentDoc)
      } catch {
        // Self-correction failed, try compiling again anyway
      }
    } else {
      yield {
        type: 'compile_error',
        error: `Compilation failed after ${maxRetries} attempts: ${result.errors?.join('; ')}`,
      }
    }
  }

  // After successful compile, let the AI review the rendered PDF
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
        // Try to fix the issue with one more edit + compile cycle
        yield { type: 'status', message: 'Fixing a visual issue...' }
        try {
          const currentDoc = await readProjectFile(params.projectId, 'main.tex')
          if (currentDoc) {
            const fixResult = await editDocumentWithTool({
              currentDocument: currentDoc,
              instruction: `[System: The previous edit was supposed to do: "${params.userMessage}" but the visual review found this problem: "${pdfReview}". Fix it now. Make sure any \\includegraphics commands use the EXACT filename from the conversation.]`,
              chatHistory: [],
              model: params.model,
            })
            if (fixResult.edits.length > 0 && fixResult.latex !== currentDoc) {
              await uploadProjectFile(params.projectId, 'main.tex', fixResult.latex)
              const fixCompile = await compileProject(params.projectId)
              if (fixCompile.success) {
                yield { type: 'compile_done', message: 'Fixed and recompiled!' }
                reviewNote = ''
              } else {
                reviewNote = '\n\n' + pdfReview
              }
            } else {
              reviewNote = '\n\n' + pdfReview
            }
          }
        } catch (fixErr) {
          console.warn('[Orchestrator] Review fix attempt failed:', fixErr)
          reviewNote = '\n\n' + pdfReview
        }
      }
    } catch (err) {
      console.warn('[Orchestrator] PDF review failed:', err)
    }
  }

  // Save assistant message
  const compileNote = compileSuccess
    ? ''
    : '\n\n(There were some compilation issues — the PDF may not reflect all changes.)'
  const summary = (aiReply || 'Your changes have been applied.') + compileNote + reviewNote

  await supabase.from('messages').insert({
    project_id: params.projectId,
    role: 'assistant',
    content: summary,
  })

  yield { type: 'done', message: summary }
}

// --- Quick chat (no document needed) ---

async function quickChat(params: {
  message: string
  chatHistory: { role: string; content: string }[]
  model?: string
}): Promise<string> {
  const messages = [
    {
      role: 'system' as const,
      content: 'You are AlefBook\'s AI assistant for a Hebrew/English book creation platform. Respond briefly and helpfully. If the user seems to want to edit their document, let them know you can help — just tell you what to change.',
    },
    ...params.chatHistory.slice(-20).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: params.message },
  ]

  return callLLM(messages, {
    model: params.model,
    maxTokens: 512,
    temperature: 0.5,
  })
}

// --- Document Q&A (read doc, no edit/compile) ---

async function answerQuestion(params: {
  document: string
  message: string
  chatHistory: { role: string; content: string }[]
  model?: string
}): Promise<string> {
  const messages = [
    {
      role: 'system' as const,
      content: `You are AlefBook's AI assistant. The user is asking a question about their LaTeX document. Answer concisely based on the document content. Do NOT return the full document — just answer the question.`,
    },
    ...params.chatHistory.slice(-20).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    {
      role: 'user' as const,
      content: `## Document:\n\`\`\`latex\n${params.document}\n\`\`\`\n\n## Question: ${params.message}`,
    },
  ]

  return callLLM(messages, {
    model: params.model,
    maxTokens: 1024,
    temperature: 0.3,
  })
}

// --- Image generation ---

async function handleImageGeneration(params: {
  projectId: string
  instruction: string
  imageModel?: string
}): Promise<string> {
  const { generateImage } = await import('./openrouter')
  const { uploadProjectImage } = await import('@/lib/latex/compiler')

  const result = await generateImage(params.instruction, params.imageModel)
  const filename = `gen-${Date.now()}.png`

  const buffer = Buffer.from(result.b64, 'base64')
  await uploadProjectImage(params.projectId, filename, buffer)

  return filename
}

// --- PDF visual review ---

/**
 * Two-step review:
 * 1. Ask the AI (cheaply, text-only) which pages it expects its edit to affect
 * 2. Render those pages + page 1 (always), send images back for visual QA
 */
async function reviewCompiledPdf(params: {
  projectId: string
  userMessage: string
  model?: string
}): Promise<string | null> {
  const supabase = createServiceClient()

  // Download the compiled PDF
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

  // Get total page count
  let totalPages = 0
  try {
    totalPages = await getPdfPageCount(pdfBuffer)
  } catch {
    totalPages = 40 // fallback estimate
  }

  // Step 1: Ask the AI which pages to check
  let pagesToRender: number[]
  try {
    const pagePickResponse = await callLLM(
      [
        {
          role: 'system' as const,
          content: `You are an assistant that helps pick which PDF pages to visually review after an edit. Given the user's edit request and the LaTeX document, estimate which compiled PDF pages were most likely affected by the changes.

The PDF has ${totalPages} total pages. Return ONLY a JSON array of page numbers (integers), e.g. [3, 7, 12]. Pick 3-5 pages max that are most likely to show the edit results. Always include the first page and the last page of the document.

Common reference: The cover is page 1, TOC is ~page 3, Kadesh starts ~page 5, Maggid ~page 7, the Seder steps continue through the middle, and Hallel/Nirtzah are near the end.`,
        },
        {
          role: 'user' as const,
          content: `Edit request: "${params.userMessage}"\n\nWhich ${totalPages}-page PDF pages should I render to visually check the edit? Return ONLY a JSON array.`,
        },
      ],
      { model: params.model, maxTokens: 64, temperature: 0.1 }
    )

    // Parse the JSON array from response
    const match = pagePickResponse.match(/\[[\d\s,]+\]/)
    if (match) {
      pagesToRender = JSON.parse(match[0])
        .filter((n: number) => n >= 1 && n <= totalPages)
        .slice(0, 6)
    } else {
      pagesToRender = [1, Math.ceil(totalPages / 2), totalPages]
    }
  } catch {
    // Fallback: first, middle, last
    pagesToRender = [1, Math.ceil(totalPages / 2), totalPages]
  }

  // Always include page 1
  if (!pagesToRender.includes(1)) pagesToRender.unshift(1)
  pagesToRender = Array.from(new Set(pagesToRender)).sort((a, b) => a - b).slice(0, 6)

  console.log(`[AI Review] PDF has ${totalPages} pages, AI chose to inspect: ${pagesToRender.join(', ')}`)

  const pages = await renderPdfPages(pdfBuffer, pagesToRender, 150)
  if (pages.length === 0) return null

  // Step 2: Send rendered pages for visual review
  const imageContent = pages.map(p => ({
    type: 'image_url' as const,
    image_url: { url: `data:image/png;base64,${p.base64}` },
  }))

  const messages = [
    {
      role: 'system' as const,
      content: `You are the visual QA reviewer for AlefBook, a Hebrew/English Haggadah. You just edited the document based on the user's request. Now check the rendered PDF pages to make sure your edit looks correct.

The user asked: "${params.userMessage}"

IMPORTANT — Be strict. Check carefully:
- If the user asked to ADD AN IMAGE: Is a new image/illustration ACTUALLY VISIBLE on the page? An image should be a distinct graphic element, not just text. If you don't see a new picture/illustration, the edit FAILED.
- If the user asked to CHANGE A COLOR: Is the color actually different from the standard blue/gold Haggadah theme?
- If the user asked to ADD TEXT: Is the new text actually visible on the page?
- Also check for: text overflowing into margins, Hebrew text garbled, blank pages, layout issues.

Do NOT say "Pages look good" unless you can clearly see the requested change. When in doubt, say the edit is missing.

If you see a problem, describe it in 1-2 simple sentences (no source code references).
If everything truly looks correct, say "Pages look good." — nothing more.`,
    },
    {
      role: 'user' as const,
      content: [
        {
          type: 'text' as const,
          text: `Here are ${pages.length} rendered pages from the ${totalPages}-page PDF (pages ${pages.map(p => p.page).join(', ')}). Visually verify the edit looks right.`,
        },
        ...imageContent,
      ],
    },
  ]

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- multimodal content type
    const review = await callLLM(messages as any, {
      model: params.model,
      maxTokens: 512,
      temperature: 0.2,
    })
    return review
  } catch (err) {
    console.warn('[AI] PDF review LLM call failed:', err)
    return null
  }
}

// --- Migration helper for old split-file projects ---

async function assembleOldProject(projectId: string, mainTex: string): Promise<string | null> {
  const preamble = await readProjectFile(projectId, 'preamble.tex')
  if (!preamble) return null

  // Extract \input{pages/page-NNN} lines from main.tex
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

