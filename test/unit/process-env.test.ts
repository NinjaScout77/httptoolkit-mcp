import { describe, it, expect } from 'vitest';

import {
  getNativeBinaryPath,
  getEnvVarFromPid,
  findServerPid,
  autoDetectToken,
} from '../../src/util/process-env.js';

// We can't easily mock ESM module internals, so we test behavior at the boundaries.
// For the native binary tests, we test against the real compiled binary if it exists.

describe('getNativeBinaryPath', () => {
  it('returns a path on supported platforms when binary exists', () => {
    // This test only passes when the prebuilt binary exists for the current platform
    const binaryPath = getNativeBinaryPath();
    if (process.platform === 'darwin' || process.platform === 'linux') {
      // May or may not exist depending on whether we've built
      if (binaryPath) {
        expect(binaryPath).toContain('htk-getenv');
        expect(binaryPath).toContain('prebuilds');
      }
    }
  });

  it('returns string or null, never throws', () => {
    expect(() => getNativeBinaryPath()).not.toThrow();
  });
});

describe('getEnvVarFromPid', () => {
  it('returns null for invalid PID', () => {
    expect(getEnvVarFromPid(0, 'PATH')).toBeNull();
  });

  it('returns null for nonexistent PID', () => {
    expect(getEnvVarFromPid(99999999, 'PATH')).toBeNull();
  });

  it('returns null for nonexistent variable name', () => {
    // Read our own process — PID should be valid
    const result = getEnvVarFromPid(process.pid, 'THIS_VAR_DOES_NOT_EXIST_EVER_12345');
    expect(result).toBeNull();
  });

  it('reads a known env var from the current process', () => {
    // Our own process should have PATH set
    const result = getEnvVarFromPid(process.pid, 'PATH');
    if (getNativeBinaryPath()) {
      // Only test this if the binary exists
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    }
  });

  it('never throws on any input', () => {
    expect(() => getEnvVarFromPid(-1, 'X')).not.toThrow();
    expect(() => getEnvVarFromPid(0, '')).not.toThrow();
    expect(() => getEnvVarFromPid(NaN, 'Y')).not.toThrow();
  });
});

describe('findServerPid', () => {
  it('returns a number or null', () => {
    const result = findServerPid();
    expect(result === null || typeof result === 'number').toBe(true);
  });

  it('returns a positive number when HTTPToolkit is running', () => {
    const result = findServerPid();
    // This test is environment-dependent — may be null if HTK isn't running
    if (result !== null) {
      expect(result).toBeGreaterThan(0);
    }
  });

  it('never throws', () => {
    expect(() => findServerPid()).not.toThrow();
  });
});

describe('autoDetectToken', () => {
  it('returns a string or null', () => {
    const result = autoDetectToken();
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('returns non-empty string when HTTPToolkit is running with token', () => {
    const result = autoDetectToken();
    // Environment-dependent, but if it returns a value it should be non-empty
    if (result !== null) {
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('never throws', () => {
    expect(() => autoDetectToken()).not.toThrow();
  });
});

describe('getEnvVarFromPid output format', () => {
  it('returns value without key= prefix', () => {
    const result = getEnvVarFromPid(process.pid, 'PATH');
    if (result) {
      // PATH value should not start with "PATH="
      expect(result.startsWith('PATH=')).toBe(false);
      // Should contain path separators (: on unix)
      expect(result).toContain(process.platform === 'win32' ? ';' : ':');
    }
  });
});
