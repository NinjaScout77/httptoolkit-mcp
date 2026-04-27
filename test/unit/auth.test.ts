import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveAuthToken, requireAuthToken } from '../../src/httptoolkit/auth.js';
import { AuthTokenMissingError } from '../../src/core/errors.js';

describe('auth', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env['HTK_SERVER_TOKEN'];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['HTK_SERVER_TOKEN'] = originalEnv;
    } else {
      delete process.env['HTK_SERVER_TOKEN'];
    }
  });

  describe('resolveAuthToken', () => {
    it('returns token from HTK_SERVER_TOKEN env var', () => {
      process.env['HTK_SERVER_TOKEN'] = 'test-token-123';
      expect(resolveAuthToken()).toBe('test-token-123');
    });

    it('returns null when HTK_SERVER_TOKEN is not set', () => {
      delete process.env['HTK_SERVER_TOKEN'];
      expect(resolveAuthToken()).toBeNull();
    });

    it('returns null when HTK_SERVER_TOKEN is empty string', () => {
      process.env['HTK_SERVER_TOKEN'] = '';
      expect(resolveAuthToken()).toBeNull();
    });
  });

  describe('requireAuthToken', () => {
    it('returns token when HTK_SERVER_TOKEN is set', () => {
      process.env['HTK_SERVER_TOKEN'] = 'my-secret-token';
      expect(requireAuthToken()).toBe('my-secret-token');
    });

    it('throws AuthTokenMissingError when token is not available', () => {
      delete process.env['HTK_SERVER_TOKEN'];
      expect(() => requireAuthToken()).toThrow(AuthTokenMissingError);
    });

    it('throws with helpful message mentioning replay tools and README', () => {
      delete process.env['HTK_SERVER_TOKEN'];
      expect(() => requireAuthToken()).toThrow(/HTK_SERVER_TOKEN is required for replay tools/);
      expect(() => requireAuthToken()).toThrow(/README#authentication/);
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
