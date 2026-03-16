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

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4'
const FALLBACK_MODEL = 'openai/gpt-4.1'

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
 * Call an image generation model via OpenRouter
 */
export async function generateImage(
  prompt: string,
  model: string = 'openai/dall-e-3'
): Promise<{ url?: string; b64?: string }> {
  const client = getOpenRouterClient()

  const response = await client.images.generate({
    model,
    prompt,
    n: 1,
    size: '1024x1024',
  })

  const data = response.data?.[0]
  return { url: data?.url, b64: data?.b64_json }
}
