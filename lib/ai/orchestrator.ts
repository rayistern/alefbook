import { callLLM } from './openrouter'
import { compileProject, readProjectFile, uploadProjectFile, getProjectPdfUrl } from '@/lib/latex/compiler'
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

/**
 * Route user messages to the right handler:
 * - "chat": simple messages, greetings, questions → quick LLM reply, no doc loading
 * - "question": questions about the document → load doc, answer, no compile
 * - "edit": edit requests → load doc, edit, compile
 */
async function classifyIntent(message: string): Promise<'chat' | 'question' | 'edit'> {
  const msg = message.toLowerCase().trim()

  // Very short or clearly not an edit
  if (msg.length < 15 && !/\b(add|change|edit|remove|delete|replace|update|make|fix|insert|move|swap|set)\b/.test(msg)) {
    return 'chat'
  }

  // Explicit edit keywords
  if (/\b(add|change|edit|remove|delete|replace|update|make|fix|insert|move|swap|set|rewrite|translate|put|create|write)\b/i.test(msg)) {
    return 'edit'
  }

  // Question patterns
  if (/^(what|how|why|where|when|which|who|is|are|does|do|can|could|would|tell me|explain|show me|list)\b/i.test(msg)) {
    return 'question'
  }

  // Default to edit for anything ambiguous
  return 'edit'
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

  // --- QUESTION or EDIT: need to load the document ---
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

  // --- EDIT: diff-based edit + compile loop ---

  // Check if user explicitly wants an image generated
  const wantsImage = /\b(generate|create|make|draw)\s+(an?\s+)?(image|picture|illustration|artwork)\b/i.test(params.userMessage)
  let imageFilename: string | null = null

  if (wantsImage) {
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

  const editInstruction = imageFilename
    ? `${params.userMessage}\n\n[System: An image has been generated and saved as images/${imageFilename}. Insert it using \\includegraphics{images/${imageFilename}} at the appropriate location.]`
    : params.userMessage

  // ── NEW: diff-based editing via search/replace tool ──
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

  const aiReply = editResult.reply
  let currentDoc = editResult.latex

  // Log edit results
  console.log(`[Orchestrator] Edit applied: ${editResult.edits.length} changes, ${editResult.failedEdits.length} failed`)

  // Show the AI's conversational reply immediately
  if (aiReply) {
    yield { type: 'message', message: aiReply }
  }

  // If no edits were made (just a reply), we're done
  if (editResult.edits.length === 0 && editResult.failedEdits.length === 0) {
    await supabase.from('messages').insert({
      project_id: params.projectId,
      role: 'assistant',
      content: aiReply,
    })
    yield { type: 'done', message: aiReply }
    return
  }

  // Upload modified document
  yield { type: 'status', message: 'Saving changes...' }
  await uploadProjectFile(params.projectId, 'main.tex', currentDoc)

  // Compile with self-correction loop (also diff-based now)
  yield { type: 'compile_start', message: 'Building your book...' }
  await supabase.from('projects').update({ status: 'compiling' }).eq('id', params.projectId)

  let compileSuccess = false
  const maxRetries = 3

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await compileProject(params.projectId)

    if (result.success) {
      compileSuccess = true
      yield { type: 'compile_done', message: 'Your book is ready!' }
      break
    }

    if (attempt < maxRetries) {
      yield { type: 'message', message: `Fixing a compile issue (attempt ${attempt}/${maxRetries})...` }

      try {
        // ── NEW: self-correction also uses search/replace ──
        currentDoc = await selfCorrectWithTool({
          document: currentDoc,
          errors: result.errors ?? [],
          log: result.log ?? '',
          model: params.model,
        })
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
      if (pdfReview) {
        reviewNote = '\n\n' + pdfReview
      }
    } catch (err) {
      console.warn('[Orchestrator] PDF review failed:', err)
    }
  }

  // Save assistant message
  const compileNote = compileSuccess
    ? ''
    : '\n\n⚠️ There were some compilation issues — the PDF may not reflect all changes.'
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
          content: `You are an assistant that helps pick which PDF pages to visually review after an edit. Given the user's edit request, estimate which compiled PDF pages were most likely affected.

The PDF has ${totalPages} total pages. Return ONLY a JSON array of page numbers (integers), e.g. [3, 7, 12]. Pick 3-5 pages max. Always include the first and last page.`,
        },
        {
          role: 'user' as const,
          content: `Edit request: "${params.userMessage}"\n\nWhich pages should I render to check? Return ONLY a JSON array.`,
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

  const messages = [
    {
      role: 'system' as const,
      content: `You are the visual QA reviewer for AlefBook, a Hebrew/English Haggadah. Check the rendered PDF pages after an edit.

The user asked: "${params.userMessage}"

Check for:
- Did the edit actually appear in the output?
- Missing or broken images
- Text overflowing into margins
- Hebrew text that looks garbled or reversed
- Blank pages that shouldn't be blank
- Layout issues

If everything looks good, say "Pages look good." — nothing more.
If you see a problem, describe it briefly (1-2 sentences).`,
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
    return await callLLM(messages as any, {
      model: params.model,
      maxTokens: 512,
      temperature: 0.2,
    })
  } catch (err) {
    console.warn('[AI] PDF review failed:', err)
    return null
  }
}

// --- Migration helper for old split-file projects ---

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
