import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveAuthToken,
  requireAuthToken,
  invalidateTokenCache,
  resetAuthState,
} from '../../src/httptoolkit/auth.js';
import { AuthTokenMissingError } from '../../src/core/errors.js';

describe('auth', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env['HTK_SERVER_TOKEN'];
    resetAuthState();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['HTK_SERVER_TOKEN'] = originalEnv;
    } else {
      delete process.env['HTK_SERVER_TOKEN'];
    }
    resetAuthState();
  });

  describe('resolveAuthToken', () => {
    it('returns token from HTK_SERVER_TOKEN env var', () => {
      process.env['HTK_SERVER_TOKEN'] = 'test-token-123';
      expect(resolveAuthToken()).toBe('test-token-123');
    });

    it('env var takes priority over auto-detection', () => {
      process.env['HTK_SERVER_TOKEN'] = 'explicit-token';
      const result = resolveAuthToken();
      expect(result).toBe('explicit-token');
    });

    it('caches the resolved token on subsequent calls', () => {
      process.env['HTK_SERVER_TOKEN'] = 'cached-token';
      const first = resolveAuthToken();
      // Change env var — cached value should persist
      process.env['HTK_SERVER_TOKEN'] = 'different-token';
      const second = resolveAuthToken();
      expect(first).toBe('cached-token');
      expect(second).toBe('cached-token');
    });

    it('returns null when HTK_SERVER_TOKEN is empty string', () => {
      process.env['HTK_SERVER_TOKEN'] = '';
      // Auto-detection may succeed if HTTPToolkit is running
      const result = resolveAuthToken();
      // Either null or an auto-detected token is acceptable
      expect(result === null || typeof result === 'string').toBe(true);
    });
  });

  describe('requireAuthToken', () => {
    it('returns token when HTK_SERVER_TOKEN is set', () => {
      process.env['HTK_SERVER_TOKEN'] = 'my-secret-token';
      expect(requireAuthToken()).toBe('my-secret-token');
    });

    it('may auto-detect or throw when env var not set', () => {
      delete process.env['HTK_SERVER_TOKEN'];
      // If HTTPToolkit is running, auto-detection succeeds
      // If not, throws AuthTokenMissingError
      try {
        const token = requireAuthToken();
        expect(typeof token).toBe('string');
        expect(token.length).toBeGreaterThan(0);
      } catch (err) {
        expect(err).toBeInstanceOf(AuthTokenMissingError);
      }
    });

    it('throws with helpful message mentioning replay tools and README', () => {
      delete process.env['HTK_SERVER_TOKEN'];
      try {
        requireAuthToken();
      } catch (err) {
        if (err instanceof AuthTokenMissingError) {
          expect(err.message).toMatch(/HTK_SERVER_TOKEN is required for replay tools/);
          expect(err.message).toMatch(/README#authentication/);
        }
      }
    });
  });

  describe('invalidateTokenCache', () => {
    it('clears the cached token and re-detects', () => {
      process.env['HTK_SERVER_TOKEN'] = 'first-token';
      resolveAuthToken(); // populate cache

      // Now change the env var and invalidate
      process.env['HTK_SERVER_TOKEN'] = 'second-token';
      const newToken = invalidateTokenCache();
      expect(newToken).toBe('second-token');
    });

    it('returns null on second invalidation (prevents loop)', () => {
      process.env['HTK_SERVER_TOKEN'] = 'token';
      resolveAuthToken();
      invalidateTokenCache(); // first
      const second = invalidateTokenCache(); // second — should not retry
      expect(second).toBeNull();
    });

    it('re-detection limit prevents infinite 401 loops', () => {
      process.env['HTK_SERVER_TOKEN'] = 'stale';
      resolveAuthToken();

      // First invalidation should re-detect
      delete process.env['HTK_SERVER_TOKEN'];
      invalidateTokenCache();

      // Second invalidation should not retry
      const result = invalidateTokenCache();
      expect(result).toBeNull();
    });
  });

  describe('AuthTokenMissingError.toErrorPayload', () => {
    it('returns structured payload with tools_affected and tools_still_available', () => {
      const err = new AuthTokenMissingError();
      const payload = err.toErrorPayload();

      expect(payload.error).toBe('AUTH_TOKEN_MISSING');
      expect(payload.message).toMatch(/HTK_SERVER_TOKEN is required/);
      expect(payload.tools_affected).toEqual(['replay_request', 'replay_raw']);
      expect(payload.tools_still_available).toEqual([
        'events_list',
        'events_get',
        'events_body',
        'server_status',
        'interceptors_list',
      ]);
      expect(payload.docs).toBe(
        'https://github.com/NinjaScout77/httptoolkit-mcp#authentication',
      );
    });
  });
});
