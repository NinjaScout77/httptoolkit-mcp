import { RateLimitedError } from '../core/errors.js';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  queue: Array<{ resolve: () => void; reject: (err: Error) => void }>;
  timer: ReturnType<typeof setInterval> | null;
}

function getMaxRps(): number {
  const raw = process.env['REPLAY_RATE_LIMIT_RPS'];
  if (raw !== undefined) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 10;
}

function getMaxQueue(): number {
  const raw = process.env['REPLAY_RATE_LIMIT_QUEUE'];
  if (raw !== undefined) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 100;
}

const buckets = new Map<string, TokenBucket>();

function getBucket(host: string): TokenBucket {
  const existing = buckets.get(host);
  if (existing) {
    return existing;
  }

  const maxRps = getMaxRps();
  const bucket: TokenBucket = {
    tokens: maxRps,
    lastRefill: Date.now(),
    queue: [],
    timer: null,
  };
  buckets.set(host, bucket);
  return bucket;
}

function refill(bucket: TokenBucket): void {
  const now = Date.now();
  const maxRps = getMaxRps();
  const elapsed = now - bucket.lastRefill;
  const tokensToAdd = Math.floor((elapsed / 1000) * maxRps);

  if (tokensToAdd > 0) {
    bucket.tokens = Math.min(maxRps, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }
}

function drainQueue(bucket: TokenBucket): void {
  refill(bucket);

  while (bucket.queue.length > 0 && bucket.tokens > 0) {
    bucket.tokens -= 1;
    const waiter = bucket.queue.shift();
    waiter?.resolve();
  }

  // Stop the timer if the queue is drained
  if (bucket.queue.length === 0 && bucket.timer !== null) {
    clearInterval(bucket.timer);
    bucket.timer = null;
  }
}

function ensureTimer(bucket: TokenBucket): void {
  if (bucket.timer !== null) {
    return;
  }
  const maxRps = getMaxRps();
  const intervalMs = Math.max(10, Math.floor(1000 / maxRps));
  bucket.timer = setInterval(() => drainQueue(bucket), intervalMs);
  // Don't hold the process open for the timer
  if (typeof bucket.timer === 'object' && 'unref' in bucket.timer) {
    bucket.timer.unref();
  }
}

/**
 * Acquires a rate-limit token for the given host.
 * Resolves immediately if a token is available, otherwise queues.
 * Rejects with RateLimitedError if the queue depth exceeds the configured max.
 */
export function acquire(host: string): Promise<void> {
  const bucket = getBucket(host);
  const maxQueue = getMaxQueue();

  refill(bucket);

  if (bucket.tokens > 0) {
    bucket.tokens -= 1;
    return Promise.resolve();
  }

  if (bucket.queue.length >= maxQueue) {
    return Promise.reject(new RateLimitedError(host, 1000));
  }

  return new Promise<void>((resolve, reject) => {
    bucket.queue.push({ resolve, reject });
    ensureTimer(bucket);
  });
}

/**
 * Resets all rate-limit state. Useful for testing.
 */
export function _resetForTesting(): void {
  for (const bucket of Array.from(buckets.values())) {
    if (bucket.timer !== null) {
      clearInterval(bucket.timer);
    }
    for (const waiter of bucket.queue) {
      waiter.reject(new Error('Rate limiter reset'));
    }
  }
  buckets.clear();
}
