import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkHost } from '../../src/core/allowlist.js';

describe('allowlist', () => {
  const originalEnv = process.env['REPLAY_ALLOWLIST'];

  beforeEach(() => {
    delete process.env['REPLAY_ALLOWLIST'];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['REPLAY_ALLOWLIST'] = originalEnv;
    } else {
      delete process.env['REPLAY_ALLOWLIST'];
    }
  });

  describe('when REPLAY_ALLOWLIST is unset', () => {
    it('allows all hosts with a warning', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const result = checkHost('https://anything.example.com/path');

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();

      // Verify warning was logged to stderr
      const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('no allowlist configured');
      expect(output).toContain('anything.example.com');

      stderrSpy.mockRestore();
    });
  });

  describe('exact match', () => {
    it('allows host that exactly matches a pattern', () => {
      process.env['REPLAY_ALLOWLIST'] = 'api.example.com';

      const result = checkHost('https://api.example.com/users');
      expect(result.allowed).toBe(true);
    });

    it('rejects host that does not match', () => {
      process.env['REPLAY_ALLOWLIST'] = 'api.example.com';

      const result = checkHost('https://evil.attacker.com/steal');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('evil.attacker.com');
      expect(result.reason).toContain('not in the allowlist');
    });
  });

  describe('wildcard match', () => {
    it('matches *.example.com against sub.example.com', () => {
      process.env['REPLAY_ALLOWLIST'] = '*.example.com';

      const result = checkHost('https://sub.example.com/api');
      expect(result.allowed).toBe(true);
    });

    it('does not match *.example.com against example.com (no subdomain)', () => {
      process.env['REPLAY_ALLOWLIST'] = '*.example.com';

      const result = checkHost('https://example.com/api');
      expect(result.allowed).toBe(false);
    });

    it('matches api.*.test.local against api.staging.test.local', () => {
      process.env['REPLAY_ALLOWLIST'] = 'api.*.test.local';

      const result = checkHost('https://api.staging.test.local/v1');
      expect(result.allowed).toBe(true);
    });

    it('does not match wildcard across multiple labels', () => {
      process.env['REPLAY_ALLOWLIST'] = '*.example.com';

      // deep.sub.example.com should NOT match — * matches only one label
      const result = checkHost('https://deep.sub.example.com/api');
      expect(result.allowed).toBe(false);
    });
  });

  describe('multiple patterns', () => {
    it('allows if any pattern matches', () => {
      process.env['REPLAY_ALLOWLIST'] = 'api.example.com, *.test.local, 10.0.0.1';

      expect(checkHost('https://api.example.com/a').allowed).toBe(true);
      expect(checkHost('https://staging.test.local/b').allowed).toBe(true);
      expect(checkHost('http://10.0.0.1/c').allowed).toBe(true);
    });

    it('rejects if no pattern matches', () => {
      process.env['REPLAY_ALLOWLIST'] = 'api.example.com, *.test.local';

      const result = checkHost('https://other.site.com/d');
      expect(result.allowed).toBe(false);
    });
  });

  describe('IP address handling', () => {
    it('matches a bare IP address', () => {
      process.env['REPLAY_ALLOWLIST'] = '192.168.1.100';

      const result = checkHost('http://192.168.1.100/admin');
      expect(result.allowed).toBe(true);
    });

    it('rejects a non-matching IP', () => {
      process.env['REPLAY_ALLOWLIST'] = '192.168.1.100';

      const result = checkHost('http://10.0.0.1/admin');
      expect(result.allowed).toBe(false);
    });
  });

  describe('port handling', () => {
    it('includes port in the host when URL has a non-default port', () => {
      process.env['REPLAY_ALLOWLIST'] = 'api.example.com:8080';

      expect(checkHost('https://api.example.com:8080/path').allowed).toBe(true);
      // Default port (443) is stripped by URL parser, so this won't match host:port pattern
      expect(checkHost('https://api.example.com/path').allowed).toBe(false);
    });

    it('matches wildcard with port', () => {
      process.env['REPLAY_ALLOWLIST'] = '*.example.com:8080';

      expect(checkHost('http://api.example.com:8080/test').allowed).toBe(true);
      expect(checkHost('http://api.example.com:9090/test').allowed).toBe(false);
    });
  });

  describe('case insensitivity', () => {
    it('matches case-insensitively', () => {
      process.env['REPLAY_ALLOWLIST'] = 'API.Example.COM';

      const result = checkHost('https://api.example.com/test');
      expect(result.allowed).toBe(true);
    });
  });
});
