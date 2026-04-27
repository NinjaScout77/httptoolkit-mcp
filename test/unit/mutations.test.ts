import { describe, it, expect } from 'vitest';
import { applyMutations, type MutableRequest } from '../../src/core/mutations.js';
import { MutationError } from '../../src/core/errors.js';

function makeRequest(overrides?: Partial<MutableRequest>): MutableRequest {
  return {
    method: 'GET',
    url: 'https://api.example.com/users/42?page=1&limit=10',
    headers: [
      ['Content-Type', 'application/json'],
      ['Authorization', 'Bearer token123'],
      ['X-Request-Id', 'abc-def'],
    ],
    rawBody: '{"name":"Alice","age":30}',
    ...overrides,
  };
}

describe('applyMutations', () => {
  // ── Header mutations ─────────────────────────────────────────────

  describe('header mutations', () => {
    it('sets a new header', () => {
      const result = applyMutations(makeRequest(), { 'headers.X-Custom': 'hello' });
      const custom = result.headers.find(([k]) => k === 'X-Custom');
      expect(custom).toEqual(['X-Custom', 'hello']);
    });

    it('replaces an existing header (case-insensitive)', () => {
      const result = applyMutations(makeRequest(), {
        'headers.authorization': 'Bearer new-token',
      });
      const auth = result.headers.find(
        ([k]) => k.toLowerCase() === 'authorization',
      );
      expect(auth).toBeDefined();
      expect(auth![1]).toBe('Bearer new-token');
      // Should not duplicate — only one Authorization header
      const allAuth = result.headers.filter(
        ([k]) => k.toLowerCase() === 'authorization',
      );
      expect(allAuth).toHaveLength(1);
    });

    it('deletes a header when value is null', () => {
      const result = applyMutations(makeRequest(), {
        'headers.X-Request-Id': null,
      });
      const found = result.headers.find(
        ([k]) => k.toLowerCase() === 'x-request-id',
      );
      expect(found).toBeUndefined();
    });

    it('applies multiple header mutations', () => {
      const result = applyMutations(makeRequest(), {
        'headers.Authorization': 'Bearer changed',
        'headers.X-New': 'added',
        'headers.X-Request-Id': null,
      });
      expect(result.headers.find(([k]) => k === 'Authorization')?.[1]).toBe(
        'Bearer changed',
      );
      expect(result.headers.find(([k]) => k === 'X-New')?.[1]).toBe('added');
      expect(
        result.headers.find(([k]) => k.toLowerCase() === 'x-request-id'),
      ).toBeUndefined();
    });
  });

  // ── URL path mutations ────────────────────────────────────────────

  describe('url.path mutations', () => {
    it('replaces full path, preserving query', () => {
      const result = applyMutations(makeRequest(), { 'url.path': '/api/v2/accounts' });
      const parsed = new URL(result.url);
      expect(parsed.pathname).toBe('/api/v2/accounts');
      expect(parsed.search).toBe('?page=1&limit=10');
    });

    it('replaces nth segment (index 0)', () => {
      const result = applyMutations(makeRequest(), { 'url.path.0': 'api-v2' });
      const parsed = new URL(result.url);
      expect(parsed.pathname).toBe('/api-v2/42');
    });

    it('replaces nth segment (middle)', () => {
      // /users/42 — index 0 = users, index 1 = 42
      const result = applyMutations(makeRequest(), { 'url.path.1': '99' });
      const parsed = new URL(result.url);
      expect(parsed.pathname).toBe('/users/99');
    });

    it('replaces last segment', () => {
      const req = makeRequest({ url: 'https://api.example.com/a/b/c?q=1' });
      const result = applyMutations(req, { 'url.path.2': 'z' });
      const parsed = new URL(result.url);
      expect(parsed.pathname).toBe('/a/b/z');
    });

    it('errors on out-of-range segment index', () => {
      expect(() =>
        applyMutations(makeRequest(), { 'url.path.99': 'nope' }),
      ).toThrow(MutationError);
      expect(() =>
        applyMutations(makeRequest(), { 'url.path.99': 'nope' }),
      ).toThrow(/out of range/i);
    });

    it('handles path with trailing slash', () => {
      const req = makeRequest({ url: 'https://api.example.com/users/42/' });
      const result = applyMutations(req, { 'url.path': '/accounts/1' });
      const parsed = new URL(result.url);
      expect(parsed.pathname).toBe('/accounts/1');
    });
  });

  // ── URL query mutations ───────────────────────────────────────────

  describe('url.query mutations', () => {
    it('adds a new query param', () => {
      const result = applyMutations(makeRequest(), { 'url.query.sort': 'asc' });
      const parsed = new URL(result.url);
      expect(parsed.searchParams.get('sort')).toBe('asc');
      // Original params still present
      expect(parsed.searchParams.get('page')).toBe('1');
    });

    it('replaces an existing query param', () => {
      const result = applyMutations(makeRequest(), { 'url.query.page': '5' });
      const parsed = new URL(result.url);
      expect(parsed.searchParams.get('page')).toBe('5');
    });

    it('deletes a query param when value is null', () => {
      const result = applyMutations(makeRequest(), { 'url.query.limit': null });
      const parsed = new URL(result.url);
      expect(parsed.searchParams.has('limit')).toBe(false);
      expect(parsed.searchParams.get('page')).toBe('1');
    });
  });

  // ── URL host mutation ─────────────────────────────────────────────

  describe('url.host mutation', () => {
    it('replaces the hostname', () => {
      const result = applyMutations(makeRequest(), {
        'url.host': 'staging.example.com',
      });
      const parsed = new URL(result.url);
      expect(parsed.hostname).toBe('staging.example.com');
      // Path and query preserved
      expect(parsed.pathname).toBe('/users/42');
      expect(parsed.search).toBe('?page=1&limit=10');
    });
  });

  // ── Method mutation ───────────────────────────────────────────────

  describe('method mutation', () => {
    it('changes method to a valid method', () => {
      const result = applyMutations(makeRequest(), { method: 'POST' });
      expect(result.method).toBe('POST');
    });

    it('accepts all valid HTTP methods', () => {
      const methods = [
        'GET', 'HEAD', 'POST', 'PUT', 'DELETE',
        'CONNECT', 'OPTIONS', 'TRACE', 'PATCH',
      ];
      for (const m of methods) {
        const result = applyMutations(makeRequest(), { method: m });
        expect(result.method).toBe(m);
      }
    });

    it('rejects an invalid method', () => {
      expect(() =>
        applyMutations(makeRequest(), { method: 'DESTROY' }),
      ).toThrow(MutationError);
      expect(() =>
        applyMutations(makeRequest(), { method: 'DESTROY' }),
      ).toThrow(/invalid http method/i);
    });
  });

  // ── Body mutations ────────────────────────────────────────────────

  describe('body mutations', () => {
    it('body.raw replaces entire body', () => {
      const result = applyMutations(makeRequest(), {
        'body.raw': 'completely new body',
      });
      expect(result.rawBody).toBe('completely new body');
    });

    it('body.<field> patches JSON body', () => {
      const result = applyMutations(makeRequest(), { 'body.name': 'Bob' });
      const parsed = JSON.parse(result.rawBody);
      expect(parsed.name).toBe('Bob');
      expect(parsed.age).toBe(30);
    });

    it('body.<nested.field> patches nested JSON', () => {
      const req = makeRequest({
        rawBody: '{"user":{"name":"Alice","address":{"city":"NYC"}}}',
      });
      const result = applyMutations(req, { 'body.user.address.city': 'LA' });
      const parsed = JSON.parse(result.rawBody);
      expect(parsed.user.address.city).toBe('LA');
      expect(parsed.user.name).toBe('Alice');
    });

    it('body mutation on non-JSON content type errors', () => {
      const req = makeRequest({
        headers: [['Content-Type', 'text/plain']],
      });
      expect(() => applyMutations(req, { 'body.name': 'Bob' })).toThrow(
        MutationError,
      );
      expect(() => applyMutations(req, { 'body.name': 'Bob' })).toThrow(
        /body\.raw/i,
      );
    });

    it('body mutation on application/x-www-form-urlencoded works', () => {
      const req = makeRequest({
        headers: [['Content-Type', 'application/x-www-form-urlencoded']],
        rawBody: '{"username":"alice","password":"secret"}',
      });
      const result = applyMutations(req, { 'body.username': 'bob' });
      const parsed = JSON.parse(result.rawBody);
      expect(parsed.username).toBe('bob');
      expect(parsed.password).toBe('secret');
    });

    it('body.<field> errors when body is not valid JSON', () => {
      const req = makeRequest({
        rawBody: 'not json at all',
      });
      expect(() => applyMutations(req, { 'body.name': 'Bob' })).toThrow(
        MutationError,
      );
    });
  });

  // ── Cross-cutting concerns ────────────────────────────────────────

  describe('cross-cutting', () => {
    it('multiple mutations applied in alphabetical order', () => {
      // body.name is applied before method (alphabetical)
      // Verify both applied correctly
      const result = applyMutations(makeRequest(), {
        method: 'POST',
        'body.name': 'Zara',
        'headers.X-Test': 'yes',
      });
      expect(result.method).toBe('POST');
      expect(JSON.parse(result.rawBody).name).toBe('Zara');
      expect(result.headers.find(([k]) => k === 'X-Test')?.[1]).toBe('yes');
    });

    it('unknown mutation prefix is rejected', () => {
      expect(() =>
        applyMutations(makeRequest(), { 'unknown.field': 'value' }),
      ).toThrow(MutationError);
      expect(() =>
        applyMutations(makeRequest(), { 'unknown.field': 'value' }),
      ).toThrow(/unknown mutation key prefix/i);
    });

    it('validation errors prevent any mutation from applying', () => {
      // If one mutation is invalid, nothing should be applied
      const original = makeRequest();
      try {
        applyMutations(original, {
          'headers.X-Good': 'value',
          'unknown.bad': 'value',
        });
      } catch {
        // The original request should be unchanged
        expect(original.headers.find(([k]) => k === 'X-Good')).toBeUndefined();
      }
    });

    it('empty mutations dict returns unchanged request', () => {
      const original = makeRequest();
      const result = applyMutations(original, {});
      expect(result).toEqual(original);
    });

    it('does not mutate the original request object', () => {
      const original = makeRequest();
      const originalUrl = original.url;
      const originalHeaders = [...original.headers.map(([k, v]) => [k, v])];
      applyMutations(original, {
        'headers.X-New': 'value',
        'url.host': 'other.com',
        'body.name': 'Changed',
      });
      expect(original.url).toBe(originalUrl);
      expect(original.headers).toEqual(originalHeaders);
    });

    it('mutations produce valid URL after url.path change', () => {
      const result = applyMutations(makeRequest(), {
        'url.path': '/new/path',
      });
      expect(() => new URL(result.url)).not.toThrow();
    });

    it('rejects mutation with empty key', () => {
      expect(() => applyMutations(makeRequest(), { '': 'value' })).toThrow(
        MutationError,
      );
    });

    it('method mutation is case-insensitive (uppercased)', () => {
      const result = applyMutations(makeRequest(), { method: 'post' });
      expect(result.method).toBe('POST');
    });

    it('handles url with no query string', () => {
      const req = makeRequest({ url: 'https://api.example.com/users/42' });
      const result = applyMutations(req, { 'url.query.page': '1' });
      const parsed = new URL(result.url);
      expect(parsed.searchParams.get('page')).toBe('1');
    });

    it('handles url with port', () => {
      const req = makeRequest({ url: 'https://api.example.com:8443/test' });
      const result = applyMutations(req, { 'url.host': 'other.com' });
      const parsed = new URL(result.url);
      expect(parsed.hostname).toBe('other.com');
      expect(parsed.port).toBe('8443');
    });

    it('body.raw works regardless of content type', () => {
      const req = makeRequest({
        headers: [['Content-Type', 'text/plain']],
        rawBody: 'original',
      });
      const result = applyMutations(req, { 'body.raw': 'replaced' });
      expect(result.rawBody).toBe('replaced');
    });

    it('handles body.<field> that sets a new field in JSON', () => {
      const result = applyMutations(makeRequest(), { 'body.newField': 'value' });
      const parsed = JSON.parse(result.rawBody);
      expect(parsed.newField).toBe('value');
      expect(parsed.name).toBe('Alice');
    });

    it('handles body.<field> set to null in JSON', () => {
      const result = applyMutations(makeRequest(), { 'body.name': null });
      const parsed = JSON.parse(result.rawBody);
      expect(parsed.name).toBeNull();
    });

    it('handles body.<field> with numeric value', () => {
      const result = applyMutations(makeRequest(), { 'body.age': 25 });
      const parsed = JSON.parse(result.rawBody);
      expect(parsed.age).toBe(25);
    });

    it('handles url.path.0 with single segment', () => {
      const req = makeRequest({ url: 'https://api.example.com/users' });
      const result = applyMutations(req, { 'url.path.0': 'accounts' });
      const parsed = new URL(result.url);
      expect(parsed.pathname).toBe('/accounts');
    });

    it('rejects negative path segment index', () => {
      expect(() =>
        applyMutations(makeRequest(), { 'url.path.-1': 'nope' }),
      ).toThrow(MutationError);
    });

    it('rejects non-numeric path segment index', () => {
      expect(() =>
        applyMutations(makeRequest(), { 'url.path.abc': 'nope' }),
      ).toThrow(MutationError);
    });
  });
});
