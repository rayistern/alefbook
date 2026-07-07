import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

let _rateLimits: Record<string, Ratelimit> | null = null

function getRateLimits() {
  if (!_rateLimits) {
    const redis = Redis.fromEnv()
    _rateLimits = {
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
  }
  return _rateLimits
}

type RateLimitType = 'aiCalls' | 'imageGen' | 'pdfExports' | 'uploads'

// Warn about missing Upstash config once per process, not once per request —
// otherwise an unconfigured deploy floods the logs on every chat message.
let warnedUnconfigured = false

/**
 * Check a per-user sliding-window rate limit.
 *
 * FAIL-OPEN by design: rate limiting protects against cost abuse, it is not
 * an auth boundary. If Upstash isn't configured (env vars absent — e.g. a
 * fresh local dev setup) or Redis is unreachable, we allow the request and
 * log, rather than taking the whole chat/upload path down. This is what
 * makes wiring checkLimit into routes safe to ship: behavior is unchanged
 * until UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are set.
 * (`Redis.fromEnv()` throws when they're missing, so the config check must
 * happen before getRateLimits().)
 */
export async function checkLimit(
  type: RateLimitType,
  userId: string
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    if (!warnedUnconfigured) {
      console.warn('[RateLimit] Upstash env vars not set — rate limiting is DISABLED (fail-open)')
      warnedUnconfigured = true
    }
    return { allowed: true }
  }

  try {
    const result = await getRateLimits()[type].limit(userId)
    return {
      allowed: result.success,
      retryAfterSeconds: result.success
        ? undefined
        : Math.ceil((result.reset - Date.now()) / 1000),
    }
  } catch (err) {
    // Redis outage should degrade to "no rate limiting", not "no service".
    console.error(`[RateLimit] check failed for ${type}, allowing request:`, err)
    return { allowed: true }
  }
}
