import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const redis = Redis.fromEnv()

export const rateLimits = {
  aiCalls: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, '1 h'),
    prefix: 'ratelimit:ai',
  }),
  imageGen: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '1 h'),
    prefix: 'ratelimit:imagegen',
  }),
  pdfExports: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '1 h'),
    prefix: 'ratelimit:pdf',
  }),
  uploads: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(20, '1 h'),
    prefix: 'ratelimit:uploads',
  }),
}

export async function checkLimit(
  type: keyof typeof rateLimits,
  userId: string
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const result = await rateLimits[type].limit(userId)
  return {
    allowed: result.success,
    retryAfterSeconds: result.success
      ? undefined
      : Math.ceil((result.reset - Date.now()) / 1000),
  }
}
