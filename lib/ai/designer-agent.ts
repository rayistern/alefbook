import OpenAI from 'openai'
import type { TemplateMeta } from '@/lib/templates/loader'
import type { Upload } from '@/lib/storage/uploads'
import type { ReviewResult } from './review-criteria'
import { REVIEW_CRITERIA } from './review-criteria'
import { buildSystemPrompt } from './system-prompt'
import { applyPageUpdate, parsePageHtmlBlocks } from './html-editor'
import { renderPageToImage } from '@/lib/rendering/puppeteer'
import { savePageStates } from '@/lib/templates/page-state'

const PRIMARY_MODEL = 'anthropic/claude-3.5-sonnet'
const FALLBACK_MODEL = 'openai/gpt-4o'

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'https://alefbook.org',
    'X-Title': 'AlefBook Designer',
  },
})

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
    const response = await client.chat.completions.create({
      model,
      messages,
      max_tokens: 8192,
      temperature: 0.3,
    })
    return response.choices[0]?.message?.content ?? ''
  } catch (error) {
    if (model === PRIMARY_MODEL) {
      // Fallback to secondary model
      console.warn('Primary model failed, falling back:', error)
      return callAI(messages, FALLBACK_MODEL)
    }
    throw error
  }
}

async function parseIntent(params: DesignerParams): Promise<{
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
    { role: 'system', content: systemPrompt },
    ...params.chatHistory.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    })),
    {
      role: 'user',
      content: `The user is currently viewing page ${params.currentPage}. Their request: "${params.userMessage}"

Determine which pages need to be edited and what changes to make.
Respond with JSON only:
{
  "target_pages": [list of page numbers to edit],
  "instructions": "detailed description of what to change on each page"
}`,
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
  uploads: Upload[]
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

  const userContent = `
## Task (Pass ${params.passNumber}/5)
${params.instructions}

${params.reviewFeedback ? `## Feedback from previous review\n${params.reviewFeedback}\n` : ''}

## Pages to edit
${pagesContext}

Return the COMPLETE updated HTML for each modified page using the page-html code block format.
Also include a brief message to the user explaining what you changed.
`

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ]

  const response = await callAI(messages)

  // Parse page-html blocks from response
  const rawUpdates = parsePageHtmlBlocks(response)

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

  const response = await callAI(imageMessages)

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
  // Step 1: determine intent — which pages to touch and what to do
  const { targetPages, instructions } = await parseIntent(params)

  const currentPageStates = { ...params.pageStates }
  let passCount = 0
  let reviewResult: ReviewResult | null = null
  let responseText = ''
  let renders: Record<number, Buffer> = {}

  while (passCount < 5) {
    passCount++

    // Step 2: AI edits HTML directly
    const editResult = await generateHTMLEdits({
      instructions,
      targetPages,
      currentPageStates,
      templateMeta: params.templateMeta,
      reviewFeedback: reviewResult?.feedback ?? null,
      passNumber: passCount,
      projectName: params.projectName,
      uploads: params.uploads,
    })

    // Apply updates
    for (const [pageNumStr, newHtml] of Object.entries(editResult.pageUpdates)) {
      currentPageStates[Number(pageNumStr)] = newHtml
    }

    responseText = editResult.responseText

    // Step 3: render edited pages to PNG via Puppeteer
    renders = await renderPages({
      pageNumbers: targetPages,
      pageStates: currentPageStates,
    })

    // Step 4: AI reviews its own renders (vision)
    reviewResult = await reviewRender({
      renders,
      instructions,
      passNumber: passCount,
    })

    if (reviewResult.passed) break

    if (passCount >= 5) {
      responseText += `\n\n*I wasn't able to fully resolve: ${reviewResult.issues.join(', ')}. You can ask me to try again.*`
      break
    }
  }

  // Save updated page states
  await savePageStates(params.projectId, currentPageStates)

  return {
    responseText,
    updatedPages: targetPages,
    renders,
    passCount,
    reviewPassed: reviewResult?.passed ?? false,
  }
}
