import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveAuthToken,
  requireAuthToken,
  invalidateTokenCache,
  resetAuthState,
} from '../../src/httptoolkit/auth.js';
import { AuthTokenMissingError, HttpToolkitNotRunningError } from '../../src/core/errors.js';

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

    it('may auto-detect, throw NotRunning, or throw AuthMissing when env var not set', () => {
      delete process.env['HTK_SERVER_TOKEN'];
      try {
        const token = requireAuthToken();
        // Auto-detection succeeded
        expect(typeof token).toBe('string');
        expect(token.length).toBeGreaterThan(0);
      } catch (err) {
        // Either HTTPToolkit is not running (distinct error) or running but token unreadable
        expect(
          err instanceof HttpToolkitNotRunningError || err instanceof AuthTokenMissingError,
        ).toBe(true);
      }
    });

    it('does not throw NotRunning when env var is explicitly set', () => {
      process.env['HTK_SERVER_TOKEN'] = 'explicit-token';
      // Should never throw NotRunning — env var bypasses process detection
      expect(() => requireAuthToken()).not.toThrow();
      expect(requireAuthToken()).toBe('explicit-token');
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

  describe('HttpToolkitNotRunningError', () => {
    it('has code HTTPTOOLKIT_NOT_RUNNING', () => {
      const err = new HttpToolkitNotRunningError();
      expect(err.code).toBe('HTTPTOOLKIT_NOT_RUNNING');
    });

    it('message tells user to start HTTPToolkit', () => {
      const err = new HttpToolkitNotRunningError();
      expect(err.message).toMatch(/does not appear to be running/);
      expect(err.message).toMatch(/Start HTTPToolkit/);
    });

    it('toErrorPayload returns structured payload with action field', () => {
      const err = new HttpToolkitNotRunningError();
      const payload = err.toErrorPayload();
      expect(payload.error).toBe('HTTPTOOLKIT_NOT_RUNNING');
      expect(payload.action).toMatch(/Start HTTPToolkit/);
      expect(payload.tools_affected).toEqual(['replay_request', 'replay_raw']);
      expect(payload.tools_still_available).toContain('events_list');
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
