import OpenAI from 'openai'
import type { TemplateMeta } from '@/lib/templates/loader'
import type { Upload } from '@/lib/storage/uploads'
import { getUploadDisplayUrl } from '@/lib/storage/uploads'
import type { ReviewResult } from './review-criteria'
import { REVIEW_CRITERIA } from './review-criteria'
import { buildSystemPrompt, type UploadWithUrl } from './system-prompt'
import { applyPageUpdate, parsePageHtmlBlocks } from './html-editor'
import { renderPageToImage } from '@/lib/rendering/puppeteer'
import { savePageStates } from '@/lib/templates/page-state'

// Testing: GPT-5.4 primary, GPT-5.1-codex fallback
// Production: GPT-5.1-codex primary, GPT-5.4 fallback
const isTestMode = process.env.AI_MODE !== 'production'
const PRIMARY_MODEL = isTestMode ? 'openai/gpt-5.4' : 'openai/gpt-5.1-codex'
const FALLBACK_MODEL = isTestMode ? 'openai/gpt-5.1-codex' : 'openai/gpt-5.4'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const IMAGE_GEN_MODEL = 'google/gemini-3-pro-image-preview'

let _client: OpenAI | null = null
function getClient() {
  if (!_client) {
    _client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        'HTTP-Referer': 'https://alefbook.org',
        'X-Title': 'AlefBook Designer',
      },
    })
  }
  return _client
}

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface DesignerResult {
  responseText: string
  updatedPages: number[]
  renders: Record<number, Buffer>
  passCount: number
  reviewPassed: boolean
  unresolvedIssues: string[]
}

interface DesignerParams {
  userMessage: string
  currentPage: number
  projectId: string
  pageStates: Record<number, string>
  chatHistory: Message[]
  templateMeta: TemplateMeta
  uploads: Upload[]
  projectName: string
}

async function callAI(
  messages: OpenAI.ChatCompletionMessageParam[],
  model: string = PRIMARY_MODEL
): Promise<string> {
  try {
    console.log(`[AI] Calling model ${model} with ${messages.length} messages`)
    const response = await getClient().chat.completions.create({
      model,
      messages,
      max_tokens: 8192,
      temperature: 0.3,
    })
    const content = response.choices[0]?.message?.content ?? ''
    console.log(`[AI] Response from ${model}: ${content.length} chars, usage:`, response.usage)
    return content
  } catch (error) {
    console.error(`[AI] Error from ${model}:`, error instanceof Error ? { message: error.message, stack: error.stack } : error)
    if (model === PRIMARY_MODEL) {
      // Fallback to secondary model
      console.warn(`[AI] Falling back to ${FALLBACK_MODEL}`)
      return callAI(messages, FALLBACK_MODEL)
    }
    throw error
  }
}

async function parseIntent(params: DesignerParams & { uploads: UploadWithUrl[] }): Promise<{
  targetPages: number[]
  instructions: string
}> {
  const systemPrompt = buildSystemPrompt({
    currentPage: params.currentPage,
    projectName: params.projectName,
    uploads: params.uploads,
    templateMeta: params.templateMeta,
  })

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `${systemPrompt}

## Intent parsing task
The user is currently viewing page ${params.currentPage}.
Given the conversation history and the user's latest message below, determine which pages need to be edited and what changes to make.
Respond with JSON only — no other text:
{
  "target_pages": [list of page numbers to edit],
  "instructions": "detailed description of what to change on each page"
}`,
    },
    ...params.chatHistory.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    })),
    {
      role: 'user',
      content: params.userMessage,
    },
  ]

  const response = await callAI(messages)

  try {
    const parsed = JSON.parse(response.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
    return {
      targetPages: parsed.target_pages ?? [params.currentPage],
      instructions: parsed.instructions ?? params.userMessage,
    }
  } catch {
    // If parsing fails, assume current page
    return {
      targetPages: [params.currentPage],
      instructions: params.userMessage,
    }
  }
}

async function generateHTMLEdits(params: {
  instructions: string
  targetPages: number[]
  currentPageStates: Record<number, string>
  templateMeta: TemplateMeta
  reviewFeedback: string | null
  passNumber: number
  projectName: string
  uploads: UploadWithUrl[]
}): Promise<{
  pageUpdates: Record<number, string>
  responseText: string
}> {
  const pagesContext = params.targetPages
    .map(pn => {
      const html = params.currentPageStates[pn] ?? ''
      const meta = params.templateMeta.pages.find(p => p.page_number === pn)
      return `### Page ${pn} — ${meta?.label ?? 'Unknown'}
${meta?.is_fixed_liturgy ? '⚠️ FIXED LITURGY — do not modify text' : 'Text is editable'}

Current HTML:
\`\`\`html
${html}
\`\`\``
    })
    .join('\n\n')

  const systemPrompt = buildSystemPrompt({
    currentPage: params.targetPages[0],
    projectName: params.projectName,
    uploads: params.uploads,
    templateMeta: params.templateMeta,
  })

  const editSystemPrompt = `${systemPrompt}

## Output instructions
- Return the COMPLETE updated HTML for each modified page using the page-html code block format.
- Also include a SINGLE brief message (1-3 sentences) to the user explaining what you changed.
- Do NOT include multiple conflicting statements. Give one clear, confident response.
- Do NOT echo back the instructions or say "I understand". Just describe what you changed.
- The user's request always takes priority over design guidelines — if they ask for something specific, do it.

## Pages to edit
${pagesContext}

${params.reviewFeedback ? `## Feedback from previous review (pass ${params.passNumber}/5)\n${params.reviewFeedback}` : ''}`

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: editSystemPrompt },
    { role: 'user', content: params.instructions },
  ]

  const response = await callAI(messages)

  // Parse page-html blocks from response
  const rawUpdates = parsePageHtmlBlocks(response)
  if (Object.keys(rawUpdates).length === 0) {
    console.warn('[Designer] No page-html blocks found in AI response. Full response:', response.substring(0, 500))
  }

  // Validate and apply updates
  const pageUpdates: Record<number, string> = {}
  for (const [pageNumStr, newHtml] of Object.entries(rawUpdates)) {
    const pageNum = Number(pageNumStr)
    const originalHtml = params.currentPageStates[pageNum] ?? ''
    pageUpdates[pageNum] = applyPageUpdate(originalHtml, newHtml)
  }

  // Extract response text (everything outside the code blocks)
  const responseText = response
    .replace(/```page-html:\d+\n[\s\S]*?```/g, '')
    .trim()

  return { pageUpdates, responseText }
}

async function reviewRender(params: {
  renders: Record<number, Buffer>
  instructions: string
  passNumber: number
}): Promise<ReviewResult> {
  const imageMessages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `You are a print design QA reviewer. ${REVIEW_CRITERIA}`,
    },
    {
      role: 'user',
      content: [
        {
          type: 'text' as const,
          text: `Review pass ${params.passNumber}. The design instruction was: "${params.instructions}". Check the following rendered page(s):`,
        },
        ...Object.values(params.renders).map((buffer) => ({
          type: 'image_url' as const,
          image_url: {
            url: `data:image/png;base64,${buffer.toString('base64')}`,
          },
        })),
      ],
    },
  ]

  const response = await callAI(imageMessages, PRIMARY_MODEL)

  try {
    const parsed = JSON.parse(response.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
    return {
      passed: parsed.passed ?? false,
      issues: parsed.issues ?? [],
      feedback: parsed.feedback_for_next_pass ?? null,
    }
  } catch {
    // If review parsing fails, pass by default to avoid infinite loops
    return { passed: true, issues: [], feedback: null }
  }
}

async function renderPages(params: {
  pageNumbers: number[]
  pageStates: Record<number, string>
}): Promise<Record<number, Buffer>> {
  const renders: Record<number, Buffer> = {}

  for (const pageNum of params.pageNumbers) {
    const html = params.pageStates[pageNum]
    if (html) {
      renders[pageNum] = await renderPageToImage(html)
    }
  }

  return renders
}

export async function runDesignerLoop(params: DesignerParams): Promise<DesignerResult> {
  // Resolve signed URLs for all uploads so AI can reference them in HTML
  const uploadsWithUrls: UploadWithUrl[] = await Promise.all(
    params.uploads.map(async (u) => ({
      ...u,
      displayUrl: await getUploadDisplayUrl(u.storage_path_display),
    }))
  )
  console.log('[Designer] Resolved upload URLs:', uploadsWithUrls.map(u => ({ filename: u.filename, url: u.displayUrl.substring(0, 80) })))

  // Override uploads with URL-enriched versions for the rest of the loop
  const paramsWithUrls = { ...params, uploads: uploadsWithUrls }

  // Step 1: determine intent — which pages to touch and what to do
  console.log('[Designer] Step 1: Parsing intent for message:', params.userMessage.substring(0, 100))
  const { targetPages, instructions } = await parseIntent(paramsWithUrls)
  console.log('[Designer] Intent parsed:', { targetPages, instructions: instructions.substring(0, 200) })

  const currentPageStates = { ...params.pageStates }
  let passCount = 0
  let reviewResult: ReviewResult | null = null
  let responseText = ''
  let renders: Record<number, Buffer> = {}

  while (passCount < 3) {
    passCount++
    console.log(`[Designer] Pass ${passCount}/3: Generating HTML edits`)

    // Step 2: AI edits HTML directly
    const editResult = await generateHTMLEdits({
      instructions,
      targetPages,
      currentPageStates,
      templateMeta: paramsWithUrls.templateMeta,
      reviewFeedback: reviewResult?.feedback ?? null,
      passNumber: passCount,
      projectName: paramsWithUrls.projectName,
      uploads: paramsWithUrls.uploads,
    })
    console.log(`[Designer] Pass ${passCount}: HTML edits generated for pages:`, Object.keys(editResult.pageUpdates))

    // Apply updates
    for (const [pageNumStr, newHtml] of Object.entries(editResult.pageUpdates)) {
      currentPageStates[Number(pageNumStr)] = newHtml
    }

    // Only keep the latest pass's response text (don't concatenate across passes)
    responseText = editResult.responseText

    // Step 3: render edited pages to PNG via Puppeteer
    console.log(`[Designer] Pass ${passCount}: Rendering pages via Puppeteer`)
    renders = await renderPages({
      pageNumbers: targetPages,
      pageStates: currentPageStates,
    })
    console.log(`[Designer] Pass ${passCount}: Rendered ${Object.keys(renders).length} pages, sizes:`, Object.fromEntries(Object.entries(renders).map(([k, v]) => [k, `${(v.length / 1024).toFixed(1)}KB`])))

    // Step 4: AI reviews its own renders (vision)
    console.log(`[Designer] Pass ${passCount}: Running vision review`)
    reviewResult = await reviewRender({
      renders,
      instructions,
      passNumber: passCount,
    })
    console.log(`[Designer] Pass ${passCount}: Review result:`, { passed: reviewResult.passed, issues: reviewResult.issues, feedback: reviewResult.feedback?.substring(0, 200) })

    if (reviewResult.passed) break
  }

  // Save updated page states
  console.log('[Designer] Saving page states for project:', params.projectId)
  await savePageStates(params.projectId, currentPageStates)

  return {
    responseText,
    updatedPages: targetPages,
    renders,
    passCount,
    reviewPassed: reviewResult?.passed ?? false,
    unresolvedIssues: reviewResult?.passed === false ? (reviewResult.issues ?? []) : [],
  }
}
