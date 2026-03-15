import { callLLM } from './openrouter'
import { compileProject, readProjectFile, uploadProjectFile } from '@/lib/latex/compiler'
import { createServiceClient } from '@/lib/supabase/server'
import type OpenAI from 'openai'

export interface TaskEvent {
  type: 'plan' | 'task_start' | 'task_done' | 'task_error' | 'compile_start' | 'compile_done' | 'compile_error' | 'message' | 'done'
  task?: TaskInfo
  message?: string
  error?: string
  pdfUrl?: string
}

export interface TaskInfo {
  id: string
  type: string
  status: string
  pageNumber?: number
  description?: string
}

export interface OrchestratorParams {
  projectId: string
  userMessage: string
  chatHistory: { role: 'user' | 'assistant' | 'system'; content: string }[]
  model?: string
  imageModel?: string
}

/**
 * The main agentic orchestration loop.
 * 1. Plan: analyze the request, break into tasks
 * 2. Execute: run each task (edit pages, generate images)
 * 3. Compile: run LaTeX compilation
 * 4. Review: check for errors, self-correct if needed
 */
export async function* runOrchestrator(
  params: OrchestratorParams
): AsyncGenerator<TaskEvent> {
  const supabase = createServiceClient()

  // Load project info
  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', params.projectId)
    .single()

  if (!project) {
    yield { type: 'done', error: 'Project not found' }
    return
  }

  // Load the project's file structure
  const mainTex = await readProjectFile(params.projectId, 'main.tex')
  const preambleTex = await readProjectFile(params.projectId, 'preamble.tex')

  // Load all page files
  const pages: Record<string, string> = {}
  for (let i = 1; i <= project.page_count; i++) {
    const pageNum = String(i).padStart(3, '0')
    const content = await readProjectFile(params.projectId, `pages/page-${pageNum}.tex`)
    if (content) pages[`page-${pageNum}.tex`] = content
  }

  // Step 1: Plan
  yield { type: 'plan', message: 'Analyzing your request...' }

  const plan = await createPlan({
    userMessage: params.userMessage,
    chatHistory: params.chatHistory,
    projectName: project.name,
    pageCount: project.page_count,
    mainTex: mainTex ?? '',
    preambleTex: preambleTex ?? '',
    pageSummaries: Object.entries(pages).map(([file, content]) => ({
      file,
      preview: content.substring(0, 200),
    })),
    model: params.model,
  })

  yield { type: 'plan', message: plan.explanation }

  // Save assistant plan message
  const { data: msgData } = await supabase.from('messages').insert({
    project_id: params.projectId,
    role: 'assistant',
    content: plan.explanation,
    metadata: { tasks: plan.tasks },
  }).select('id').single()

  const messageId = msgData?.id

  // Step 2: Execute tasks
  for (const task of plan.tasks) {
    const { data: taskRow } = await supabase.from('tasks').insert({
      project_id: params.projectId,
      message_id: messageId,
      type: task.type,
      status: 'running',
      page_number: task.pageNumber,
      input: { description: task.description },
    }).select('id').single()

    const taskId = taskRow?.id ?? crypto.randomUUID()

    yield {
      type: 'task_start',
      task: { id: taskId, type: task.type, status: 'running', pageNumber: task.pageNumber, description: task.description },
    }

    try {
      if (task.type === 'edit_page') {
        await executePageEdit({
          projectId: params.projectId,
          pageNumber: task.pageNumber!,
          instruction: task.description,
          currentContent: pages[`page-${String(task.pageNumber).padStart(3, '0')}.tex`] ?? '',
          preamble: preambleTex ?? '',
          model: params.model,
        })

        // Reload the page content after edit
        const pageNum = String(task.pageNumber).padStart(3, '0')
        const updated = await readProjectFile(params.projectId, `pages/page-${pageNum}.tex`)
        if (updated) pages[`page-${pageNum}.tex`] = updated
      } else if (task.type === 'edit_preamble') {
        await executePreambleEdit({
          projectId: params.projectId,
          instruction: task.description,
          currentPreamble: preambleTex ?? '',
          model: params.model,
        })
      } else if (task.type === 'generate_image') {
        await executeImageGeneration({
          projectId: params.projectId,
          pageNumber: task.pageNumber,
          instruction: task.description,
          imageModel: params.imageModel,
        })
      }

      await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', taskId)
      yield {
        type: 'task_done',
        task: { id: taskId, type: task.type, status: 'done', pageNumber: task.pageNumber, description: task.description },
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      await supabase.from('tasks').update({ status: 'failed', error: errorMsg, completed_at: new Date().toISOString() }).eq('id', taskId)
      yield {
        type: 'task_error',
        task: { id: taskId, type: task.type, status: 'failed', pageNumber: task.pageNumber, description: task.description },
        error: errorMsg,
      }
    }
  }

  // Step 3: Compile
  yield { type: 'compile_start', message: 'Compiling LaTeX...' }

  await supabase.from('projects').update({ status: 'compiling' }).eq('id', params.projectId)

  let compileAttempt = 0
  const maxRetries = 3
  let compileSuccess = false

  while (compileAttempt < maxRetries && !compileSuccess) {
    compileAttempt++
    const result = await compileProject(params.projectId)

    if (result.success) {
      compileSuccess = true
      yield { type: 'compile_done', message: 'PDF compiled successfully!' }
    } else if (compileAttempt < maxRetries) {
      // Self-correct: send errors to AI and fix
      yield { type: 'message', message: `Compile error (attempt ${compileAttempt}/${maxRetries}), auto-fixing...` }

      await selfCorrectCompileError({
        projectId: params.projectId,
        errors: result.errors ?? [],
        log: result.log ?? '',
        pages,
        preamble: preambleTex ?? '',
        model: params.model,
      })
    } else {
      yield {
        type: 'compile_error',
        error: `Compilation failed after ${maxRetries} attempts: ${result.errors?.join('; ')}`,
      }
    }
  }

  // Generate response
  const finalResponse = plan.explanation +
    (compileSuccess ? '' : '\n\nNote: There were compilation issues. The PDF may not reflect all changes.')

  yield { type: 'done', message: finalResponse }
}

// --- Plan creation ---

interface PlanTask {
  type: 'edit_page' | 'edit_preamble' | 'generate_image'
  pageNumber?: number
  description: string
}

interface Plan {
  explanation: string
  tasks: PlanTask[]
}

async function createPlan(params: {
  userMessage: string
  chatHistory: { role: string; content: string }[]
  projectName: string
  pageCount: number
  mainTex: string
  preambleTex: string
  pageSummaries: { file: string; preview: string }[]
  model?: string
}): Promise<Plan> {
  const systemPrompt = `You are a LaTeX book editor AI. You help users modify their books.

## Project: "${params.projectName}" (${params.pageCount} pages)

## Preamble (packages, macros, styles):
\`\`\`latex
${params.preambleTex.substring(0, 2000)}
\`\`\`

## Page files:
${params.pageSummaries.map(p => `- ${p.file}: ${p.preview.substring(0, 100)}...`).join('\n')}

## Your task
Given the user's request, create a plan of tasks. Respond with JSON:
{
  "explanation": "Brief 1-3 sentence explanation of what you'll do",
  "tasks": [
    {
      "type": "edit_page" | "edit_preamble" | "generate_image",
      "pageNumber": <number or null>,
      "description": "What to do"
    }
  ]
}

Guidelines:
- For style changes that affect the whole book (fonts, colors, spacing), use "edit_preamble"
- For page-specific content changes, use "edit_page" with the page number
- For image requests, use "generate_image" with a description, then "edit_page" to insert it
- Keep tasks focused and ordered logically
- If the request is simple (one page edit), just create one task`

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...params.chatHistory.slice(-10).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: params.userMessage },
  ]

  const response = await callLLM(messages, { model: params.model, jsonMode: true })

  try {
    const parsed = JSON.parse(response)
    return {
      explanation: parsed.explanation ?? 'Working on your request...',
      tasks: parsed.tasks ?? [],
    }
  } catch {
    // Fallback: treat as a single page edit
    return {
      explanation: 'Making the requested changes...',
      tasks: [{ type: 'edit_page', pageNumber: 1, description: params.userMessage }],
    }
  }
}

// --- Page editing ---

async function executePageEdit(params: {
  projectId: string
  pageNumber: number
  instruction: string
  currentContent: string
  preamble: string
  model?: string
}): Promise<void> {
  const systemPrompt = `You are a LaTeX editor. Edit the page content as instructed.

## Preamble context (packages/macros available):
\`\`\`latex
${params.preamble.substring(0, 1500)}
\`\`\`

## Rules:
- Return ONLY the complete updated LaTeX content for this page
- Do not include \\documentclass, \\begin{document}, etc. — just the page content
- Use packages/macros defined in the preamble
- For images, use \\includegraphics{images/filename.png}
- Preserve existing structure where not explicitly asked to change
- Wrap your output in \`\`\`latex code block`

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `## Current content of page ${params.pageNumber}:
\`\`\`latex
${params.currentContent}
\`\`\`

## Instruction: ${params.instruction}

Return the complete updated LaTeX for this page.`,
    },
  ]

  const response = await callLLM(messages, { model: params.model, maxTokens: 4096 })

  // Extract LaTeX from code block
  const latex = extractLatexBlock(response)
  const pageNum = String(params.pageNumber).padStart(3, '0')
  await uploadProjectFile(params.projectId, `pages/page-${pageNum}.tex`, latex)
}

// --- Preamble editing ---

async function executePreambleEdit(params: {
  projectId: string
  instruction: string
  currentPreamble: string
  model?: string
}): Promise<void> {
  const systemPrompt = `You are a LaTeX editor. Edit the document preamble as instructed.

## Rules:
- Return the COMPLETE updated preamble
- This preamble is \\input'd before \\begin{document}
- Include all \\usepackage, font definitions, color definitions, custom commands, etc.
- Do NOT include \\documentclass or \\begin{document}
- Wrap your output in \`\`\`latex code block`

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `## Current preamble:
\`\`\`latex
${params.currentPreamble}
\`\`\`

## Instruction: ${params.instruction}

Return the complete updated preamble.`,
    },
  ]

  const response = await callLLM(messages, { model: params.model, maxTokens: 4096 })
  const latex = extractLatexBlock(response)
  await uploadProjectFile(params.projectId, 'preamble.tex', latex)
}

// --- Image generation ---

async function executeImageGeneration(params: {
  projectId: string
  pageNumber?: number
  instruction: string
  imageModel?: string
}): Promise<void> {
  // Dynamic import to avoid circular deps
  const { generateImage } = await import('./openrouter')
  const { uploadProjectImage } = await import('@/lib/latex/compiler')

  const result = await generateImage(params.instruction, params.imageModel)

  if (result.url) {
    // Download the image
    const response = await fetch(result.url)
    const buffer = Buffer.from(await response.arrayBuffer())
    const filename = `gen-${Date.now()}.png`
    await uploadProjectImage(params.projectId, filename, buffer)
  } else if (result.b64) {
    const buffer = Buffer.from(result.b64, 'base64')
    const filename = `gen-${Date.now()}.png`
    await uploadProjectImage(params.projectId, filename, buffer)
  }
}

// --- Self-correction ---

async function selfCorrectCompileError(params: {
  projectId: string
  errors: string[]
  log: string
  pages: Record<string, string>
  preamble: string
  model?: string
}): Promise<void> {
  const systemPrompt = `You are a LaTeX debugger. A compilation failed. Fix the errors.

## Errors:
${params.errors.join('\n\n')}

## Log excerpt (last 2000 chars):
${params.log.slice(-2000)}

## Preamble:
\`\`\`latex
${params.preamble}
\`\`\`

## Pages:
${Object.entries(params.pages).map(([file, content]) => `### ${file}\n\`\`\`latex\n${content}\n\`\`\``).join('\n\n')}

Respond with JSON listing files to fix:
{
  "fixes": [
    { "file": "preamble.tex" | "pages/page-001.tex", "content": "full corrected content" }
  ]
}`

  const response = await callLLM(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: 'Fix the compilation errors.' }],
    { model: params.model, maxTokens: 8192, jsonMode: true }
  )

  try {
    const parsed = JSON.parse(response)
    for (const fix of parsed.fixes ?? []) {
      await uploadProjectFile(params.projectId, fix.file, fix.content)
    }
  } catch {
    console.error('[Orchestrator] Failed to parse self-correction response')
  }
}

// --- Helpers ---

function extractLatexBlock(text: string): string {
  const match = text.match(/```latex\n([\s\S]*?)```/)
  if (match) return match[1].trim()

  // Try generic code block
  const genericMatch = text.match(/```\n([\s\S]*?)```/)
  if (genericMatch) return genericMatch[1].trim()

  // Return as-is (might be raw LaTeX)
  return text.trim()
}
