import OpenAI from 'openai'

const IMAGE_MODEL = 'google/gemini-3-flash'

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

export interface ImageGenerationResult {
  url: string
  revisedPrompt: string
}

export async function generateImage(
  prompt: string
): Promise<ImageGenerationResult> {
  // Use Gemini 3 for image generation via chat completions
  const response = await getClient().chat.completions.create({
    model: IMAGE_MODEL,
    messages: [
      {
        role: 'user',
        content: `Generate an image based on this description. Return ONLY the image, no text explanation.\n\n${prompt}`,
      },
    ],
    max_tokens: 4096,
  })

  const content = response.choices[0]?.message?.content ?? ''

  // Extract image URL from response (Gemini returns images inline or as URLs)
  const urlMatch = content.match(/https?:\/\/[^\s"'<>]+\.(?:png|jpg|jpeg|webp|gif)[^\s"'<>]*/i)
  if (urlMatch) {
    return {
      url: urlMatch[0],
      revisedPrompt: prompt,
    }
  }

  // Check for base64 image data in the response
  const base64Match = content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/i)
  if (base64Match) {
    return {
      url: base64Match[0],
      revisedPrompt: prompt,
    }
  }

  // Fallback: try DALL-E 3 through OpenRouter if Gemini didn't return an image
  try {
    const dalleResponse = await getClient().images.generate({
      model: 'openai/dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
    })

    const image = dalleResponse.data?.[0]
    if (image?.url) {
      return {
        url: image.url,
        revisedPrompt: image.revised_prompt ?? prompt,
      }
    }
  } catch (fallbackError) {
    console.error('DALL-E fallback also failed:', fallbackError)
  }

  throw new Error('Image generation returned no result')
}
