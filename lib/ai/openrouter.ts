import OpenAI from 'openai'

let _client: OpenAI | null = null

export function getOpenRouterClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        'HTTP-Referer': 'https://www.shluchimexchange.ai',
        'X-Title': 'Shluchim Exchange',
      },
    })
  }
  return _client
}

const DEFAULT_MODEL = 'openai/gpt-5.1-codex-mini'
const FALLBACK_MODEL = 'openai/gpt-4.1-mini'

/**
 * Call LLM with tool/function calling support.
 * Returns the full message object so callers can inspect tool_calls.
 */
export async function callLLMWithTools(
  messages: OpenAI.ChatCompletionMessageParam[],
  tools: OpenAI.ChatCompletionTool[],
  options?: {
    model?: string
    maxTokens?: number
    temperature?: number
    toolChoice?: 'auto' | 'none' | 'required'
  }
): Promise<OpenAI.ChatCompletionMessage> {
  const model = options?.model ?? DEFAULT_MODEL

  try {
    const response = await getOpenRouterClient().chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: options?.toolChoice ?? 'auto',
      max_tokens: options?.maxTokens ?? 16384,
      temperature: options?.temperature ?? 0.3,
    })

    const msg = response.choices[0]?.message
    if (!msg) throw new Error('No message in response')

    const toolCalls = msg.tool_calls?.length ?? 0
    const contentLen = msg.content?.length ?? 0
    console.log(`[AI] ${model}: ${contentLen} chars, ${toolCalls} tool calls`)
    return msg
  } catch (error) {
    console.error(`[AI] Error from ${model}:`, error instanceof Error ? error.message : error)

    if (model !== FALLBACK_MODEL) {
      console.warn(`[AI] Falling back to ${FALLBACK_MODEL}`)
      return callLLMWithTools(messages, tools, { ...options, model: FALLBACK_MODEL })
    }
    throw error
  }
}

export async function callLLM(
  messages: OpenAI.ChatCompletionMessageParam[],
  options?: {
    model?: string
    maxTokens?: number
    temperature?: number
    jsonMode?: boolean
  }
): Promise<string> {
  const model = options?.model ?? DEFAULT_MODEL

  try {
    const response = await getOpenRouterClient().chat.completions.create({
      model,
      messages,
      max_tokens: options?.maxTokens ?? 8192,
      temperature: options?.temperature ?? 0.3,
      ...(options?.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    })

    const content = response.choices[0]?.message?.content ?? ''
    console.log(`[AI] ${model}: ${content.length} chars`)
    return content
  } catch (error) {
    console.error(`[AI] Error from ${model}:`, error instanceof Error ? error.message : error)

    // Fallback
    if (model !== FALLBACK_MODEL) {
      console.warn(`[AI] Falling back to ${FALLBACK_MODEL}`)
      return callLLM(messages, { ...options, model: FALLBACK_MODEL })
    }
    throw error
  }
}

/**
 * Generate an image via OpenRouter's chat completions endpoint.
 * Uses the modalities parameter to request image output.
 */
const IMAGE_MODELS = [
  'openai/gpt-5-image-mini',
  'google/gemini-2.5-flash-image',
  'black-forest-labs/flux.2-flex',
]

export async function generateImage(
  prompt: string,
  model?: string
): Promise<{ b64: string }> {
  if (model) {
    return tryGenerateImage(prompt, model)
  }
  // Try each model in order until one works
  for (const m of IMAGE_MODELS) {
    try {
      return await tryGenerateImage(prompt, m)
    } catch (err) {
      console.warn(`[Image] ${m} failed:`, err instanceof Error ? err.message : err)
    }
  }
  throw new Error(`All image models failed: ${IMAGE_MODELS.join(', ')}`)
}

async function tryGenerateImage(
  prompt: string,
  model: string
): Promise<{ b64: string }> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://www.shluchimexchange.ai',
      'X-Title': 'Shluchim Exchange',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      modalities: ['image'],
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Image generation failed (${response.status}): ${text.slice(0, 200)}`)
  }

  const data = await response.json()
  const message = data.choices?.[0]?.message
  const content = message?.content

  // String content: "data:image/png;base64,..."
  if (typeof content === 'string' && content.startsWith('data:image')) {
    const b64 = content.replace(/^data:image\/\w+;base64,/, '')
    return { b64 }
  }

  // Array content: [{type: "image_url", image_url: {url: "data:..."}}]
  if (Array.isArray(content)) {
    for (const part of content) {
      const url = part?.image_url?.url || (typeof part === 'string' && part.startsWith('data:image') ? part : null)
      if (url) {
        const b64 = url.replace(/^data:image\/\w+;base64,/, '')
        return { b64 }
      }
    }
  }

  // Some models return images array on the message
  const images = message?.images
  if (Array.isArray(images) && images.length) {
    const img = images[0]
    const url = typeof img === 'string' ? img : img?.image_url?.url || img?.url || img?.b64
    if (url) {
      const b64 = typeof url === 'string' && url.startsWith('data:') ? url.replace(/^data:image\/\w+;base64,/, '') : url
      return { b64 }
    }
  }

  console.error('[Image] Unexpected response shape:', JSON.stringify(data.choices?.[0]?.message).slice(0, 500))
  throw new Error('No image data in response')
}
