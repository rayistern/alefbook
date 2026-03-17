import OpenAI from 'openai'

let _client: OpenAI | null = null

export function getOpenRouterClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        'HTTP-Referer': 'https://alefbook.org',
        'X-Title': 'AlefBook',
      },
    })
  }
  return _client
}

const DEFAULT_MODEL = 'openai/gpt-5.1-codex-mini'
const FALLBACK_MODEL = 'openai/gpt-4.1-mini'

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
export async function generateImage(
  prompt: string,
  model: string = 'google/gemini-2.5-flash-image-preview'
): Promise<{ b64: string }> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://alefbook.org',
      'X-Title': 'AlefBook',
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
  const content = data.choices?.[0]?.message?.content

  // Response contains base64 data URL: "data:image/png;base64,..."
  if (typeof content === 'string' && content.startsWith('data:image')) {
    const b64 = content.replace(/^data:image\/\w+;base64,/, '')
    return { b64 }
  }

  // Some models return images array
  const images = data.choices?.[0]?.message?.images
  if (images?.length) {
    const img = images[0]
    const b64 = img.startsWith('data:') ? img.replace(/^data:image\/\w+;base64,/, '') : img
    return { b64 }
  }

  throw new Error('No image data in response')
}
