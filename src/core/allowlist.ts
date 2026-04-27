import { createLogger } from '../util/logger.js';
import { OutOfScopeError } from '../core/errors.js';

const logger = createLogger('allowlist');

interface AllowlistResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Converts a glob-like pattern (with `*` wildcards) into a RegExp.
 * Each `*` matches one or more non-dot label characters within a single DNS label,
 * or the entire remainder when placed as a standalone segment.
 */
function patternToRegex(pattern: string): RegExp {
  // Escape regex-special characters except `*`
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // Replace `*` with a regex that matches any sequence of non-dot characters (one or more)
  const regexStr = '^' + escaped.replace(/\*/g, '[^.]+') + '$';
  return new RegExp(regexStr, 'i');
}

function extractHost(url: string): string {
  try {
    const parsed = new URL(url);
    // host includes port if non-default
    return parsed.host;
  } catch {
    // If URL parsing fails, try treating the whole thing as a host
    return url;
  }
}

function loadPatterns(): string[] | null {
  const raw = process.env['REPLAY_ALLOWLIST'];
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Checks whether a target URL's host is permitted by the configured allowlist.
 *
 * - If `REPLAY_ALLOWLIST` is unset: allows the request but logs a warning.
 * - If set: the host (including port if present) must match at least one pattern.
 */
export function checkHost(url: string): AllowlistResult {
  const host = extractHost(url);
  const patterns = loadPatterns();

  if (patterns === null) {
    logger.warn(`no allowlist configured, allowing replay to ${host}`);
    return { allowed: true };
  }

  const regexes = patterns.map(patternToRegex);
  const matched = regexes.some((re) => re.test(host));

  if (matched) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: new OutOfScopeError(host, patterns).message,
  };
}
