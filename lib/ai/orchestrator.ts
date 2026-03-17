import { callLLM } from './openrouter'
import { compileProject, readProjectFile, uploadProjectFile } from '@/lib/latex/compiler'
import { createServiceClient } from '@/lib/supabase/server'
import { renderPdfPages, getPdfPageCount } from '@/lib/latex/pdf-to-image'

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

  // --- EDIT: full edit + compile loop ---

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

  let edited: string
  let aiReply: string
  const editInstruction = imageFilename
    ? `${params.userMessage}\n\n[System: An image has been generated and saved as images/${imageFilename}. Insert it using \\includegraphics{images/${imageFilename}} at the appropriate location.]`
    : params.userMessage

  try {
    const result = await editDocument({
      currentDocument: document,
      instruction: editInstruction,
      chatHistory: params.chatHistory,
      model: params.model,
    })
    edited = result.latex
    aiReply = result.reply
  } catch (err) {
    yield { type: 'done', error: `Edit failed: ${err instanceof Error ? err.message : 'Unknown error'}` }
    return
  }

  // Show the AI's conversational reply immediately
  if (aiReply) {
    yield { type: 'message', message: aiReply }
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
      yield { type: 'message', message: `Fixing a compile issue (attempt ${attempt}/${maxRetries})...` }

      try {
        currentDoc = await selfCorrectDocument({
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

// --- Document editing ---

async function editDocument(params: {
  currentDocument: string
  instruction: string
  chatHistory: { role: string; content: string }[]
  model?: string
}): Promise<{ latex: string; reply: string }> {
  const systemPrompt = `You are a LaTeX document editor and helpful assistant for AlefBook, a Hebrew/English book creation platform. The user will give you a complete LaTeX document and a message.

## Response format:
1. First, write a brief conversational reply (1-3 sentences) addressing what the user said — explain what you changed, answer their question, etc. Be natural and specific.
2. Then return the COMPLETE modified LaTeX document in a \`\`\`latex code block.

## CRITICAL — DO NOT TRUNCATE:
- You MUST return the ENTIRE document from \\documentclass to \\end{document}.
- NEVER use shortcuts like "... remaining content unchanged ...", "% rest of document", or similar placeholders.
- NEVER skip or summarize sections. Every single line of the original document must appear in your output (with only the requested modifications applied).
- The document may be very long (1800+ lines). You MUST output all of it. If you truncate, the user's book will be destroyed.

## Rules:
- If the user asks a question without requesting changes, still return the full document unchanged in the code block, but answer their question in your reply.
- ONLY modify the parts relevant to the user's request
- Do NOT change any other content, formatting, or structure
- Preserve all existing macros, packages, and definitions exactly as-is
- If the instruction is unclear, make your best interpretation and apply it

## Image uploads:
- When you see \`[Uploaded: filename.png]\` in a message, it means the user uploaded that image to the project. It is NOT a message from the user — it is a system notification.
- To use an uploaded image in the document, reference it as: \\includegraphics{images/filename.png}
- Only insert the image if the user's actual message asks for it (e.g. "add this image to the title page").

## Chat history:
- You have access to the conversation history. Messages from the user are their requests; messages from the assistant are your prior replies. Use context from earlier messages to understand follow-up requests like "try again" or "undo that".`

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...params.chatHistory.slice(-20).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    {
      role: 'user' as const,
      content: `## Current document:\n\`\`\`latex\n${params.currentDocument}\n\`\`\`\n\n## User message: ${params.instruction}\n\nReply to the user, then return the complete LaTeX document.`,
    },
  ]

  const response = await callLLM(messages, {
    model: params.model,
    maxTokens: 65536,
    temperature: 0.2,
  })

  const latex = extractLatexBlock(response)
  const reply = extractReply(response)

  // Sanity check: must have \documentclass and \end{document}
  if (!latex.includes('\\documentclass') || !latex.includes('\\end{document}')) {
    throw new Error('AI returned incomplete document (missing \\documentclass or \\end{document})')
  }

  // Sanity check: reject if AI truncated the document (returned <70% of original length)
  const originalLen = params.currentDocument.length
  if (latex.length < originalLen * 0.7) {
    console.error(`[AI] Document truncated: ${latex.length} chars vs ${originalLen} original`)
    throw new Error('AI truncated the document. Please try again with a simpler edit request.')
  }

  return { latex, reply }
}

// --- Self-correction ---

async function selfCorrectDocument(params: {
  document: string
  errors: string[]
  log: string
  model?: string
}): Promise<string> {
  const systemPrompt = `You are a LaTeX debugger. A document failed to compile. Fix ONLY the errors — do not change anything else.

## Errors:
${params.errors.join('\n\n')}

## Log excerpt (last 2000 chars):
${params.log.slice(-2000)}

Return the COMPLETE corrected LaTeX document in a \`\`\`latex code block.`

  const response = await callLLM(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `\`\`\`latex\n${params.document}\n\`\`\`\n\nFix the compilation errors and return the complete corrected document.` },
    ],
    { model: params.model, maxTokens: 16384, temperature: 0.1 }
  )

  const latex = extractLatexBlock(response)

  if (!latex.includes('\\documentclass') || !latex.includes('\\end{document}')) {
    throw new Error('Self-correction returned incomplete document')
  }

  return latex
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

Check for:
- Did the edit actually appear in the output? (e.g. if user asked to add an image, is it visible?)
- Missing or broken images (empty boxes, "[image]" placeholders)
- Text overflowing into margins or overlapping the gold decorative lines
- Hebrew text that looks garbled or reversed
- Blank pages that shouldn't be blank
- Layout issues (text too cramped, huge gaps, etc.)

If you see a specific problem, describe it briefly (1-2 sentences).
If everything looks good, say "Pages look good." — nothing more.`,
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

// --- Helpers ---

function extractReply(text: string): string {
  // Everything before the first code block is the conversational reply
  const codeBlockStart = text.indexOf('```')
  if (codeBlockStart > 0) {
    return text.slice(0, codeBlockStart).trim()
  }
  return ''
}

function extractLatexBlock(text: string): string {
  const match = text.match(/```latex\n([\s\S]*?)```/)
  if (match) return match[1].trim()

  const genericMatch = text.match(/```\n([\s\S]*?)```/)
  if (genericMatch) return genericMatch[1].trim()

  // Return as-is (might be raw LaTeX)
  return text.trim()
}
