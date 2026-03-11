import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'https://alefbook.org',
    'X-Title': 'AlefBook Designer',
  },
})

// PHASE 3: Add image generation prompt templates here

export interface ImageGenerationResult {
  url: string
  revisedPrompt: string
}

export async function generateImage(
  prompt: string
): Promise<ImageGenerationResult> {
  const response = await client.images.generate({
    model: 'openai/dall-e-3',
    prompt,
    n: 1,
    size: '1024x1024',
    quality: 'standard',
  })

  const image = response.data?.[0]
  if (!image?.url) {
    throw new Error('Image generation returned no result')
  }

  return {
    url: image.url,
    revisedPrompt: image.revised_prompt ?? prompt,
  }
}
