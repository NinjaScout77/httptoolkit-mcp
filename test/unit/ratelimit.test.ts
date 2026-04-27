import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { acquire, _resetForTesting } from '../../src/core/ratelimit.js';

describe('ratelimit', () => {
  const originalRps = process.env['REPLAY_RATE_LIMIT_RPS'];
  const originalQueue = process.env['REPLAY_RATE_LIMIT_QUEUE'];

  beforeEach(() => {
    vi.useFakeTimers();
    _resetForTesting();
    delete process.env['REPLAY_RATE_LIMIT_RPS'];
    delete process.env['REPLAY_RATE_LIMIT_QUEUE'];
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetForTesting();
    if (originalRps !== undefined) process.env['REPLAY_RATE_LIMIT_RPS'] = originalRps;
    else delete process.env['REPLAY_RATE_LIMIT_RPS'];
    if (originalQueue !== undefined) process.env['REPLAY_RATE_LIMIT_QUEUE'] = originalQueue;
    else delete process.env['REPLAY_RATE_LIMIT_QUEUE'];
  });

  it('acquires immediately when tokens are available', async () => {
    // Default is 10 RPS, so first call should resolve instantly
    await expect(acquire('api.example.com')).resolves.toBeUndefined();
  });

  it('allows up to max RPS tokens before queueing', async () => {
    process.env['REPLAY_RATE_LIMIT_RPS'] = '3';

    // First 3 should resolve immediately
    await expect(acquire('host.test')).resolves.toBeUndefined();
    await expect(acquire('host.test')).resolves.toBeUndefined();
    await expect(acquire('host.test')).resolves.toBeUndefined();

    // 4th should queue — create a promise and check it hasn't resolved yet
    let resolved = false;
    const p = acquire('host.test').then(() => {
      resolved = true;
    });

    // Give microtasks a chance to run
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    // Advance time enough for a refill
    await vi.advanceTimersByTimeAsync(1000);
    expect(resolved).toBe(true);

    await p;
  });

  it('rejects when queue depth exceeds max', async () => {
    process.env['REPLAY_RATE_LIMIT_RPS'] = '1';
    process.env['REPLAY_RATE_LIMIT_QUEUE'] = '2';

    // Consume the one available token
    await acquire('overflow.test');

    // Queue 2 — these should be pending
    const p1 = acquire('overflow.test');
    const p2 = acquire('overflow.test');

    // 3rd queued request should be rejected (queue depth > 2)
    await expect(acquire('overflow.test')).rejects.toThrow('Rate limited');

    // Clean up pending promises
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.allSettled([p1, p2]);
  });

  it('maintains independent buckets per host', async () => {
    process.env['REPLAY_RATE_LIMIT_RPS'] = '1';

    // Consume token for host A
    await acquire('host-a.test');

    // Host B should still have its own bucket with available tokens
    await expect(acquire('host-b.test')).resolves.toBeUndefined();
  });

  it('refills tokens over time', async () => {
    process.env['REPLAY_RATE_LIMIT_RPS'] = '2';

    // Consume all 2 tokens
    await acquire('refill.test');
    await acquire('refill.test');

    // Next call should queue
    let resolved = false;
    const p = acquire('refill.test').then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    // After 500ms at 2 RPS, 1 token should refill
    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).toBe(true);

    await p;
  });
});
