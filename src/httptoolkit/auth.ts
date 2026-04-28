import { AuthTokenMissingError } from '../core/errors.js';
import { autoDetectToken } from '../util/process-env.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('auth');

/**
 * Cached auth token and its source. Populated lazily on first call to
 * resolveAuthToken(). Invalidated by invalidateTokenCache() when a 401
 * response indicates the token is stale (e.g., HTTPToolkit restarted).
 */
let cachedToken: string | null = null;
let cachePopulated = false;
let redetectAttempted = false;

/**
 * Resolves the HTTPToolkit server auth token.
 *
 * Resolution chain (first non-null wins):
 *   1. HTK_SERVER_TOKEN env var (explicit user override — highest priority)
 *   2. Auto-detection from running HTTPToolkit server process
 *   3. null — read tools still work via socket, replay tools surface AuthRequiredError
 *
 * The result is cached for the MCP process lifetime. Cache is invalidated
 * on 401 responses via invalidateTokenCache(), triggering one re-detection attempt.
 */
export function resolveAuthToken(): string | null {
  if (cachePopulated) {
    return cachedToken;
  }

  // 1. Explicit env var (always highest priority)
  const envToken = process.env['HTK_SERVER_TOKEN']?.trim();
  if (envToken && envToken.length > 0) {
    log.debug('Auth token resolved from HTK_SERVER_TOKEN env var');
    cachedToken = envToken;
    cachePopulated = true;
    return cachedToken;
  }

  // 2. Auto-detect from running server process
  const detected = autoDetectToken();
  if (detected) {
    log.info('Auth token auto-detected from running HTTPToolkit server');
    cachedToken = detected;
    cachePopulated = true;
    return cachedToken;
  }

  // 3. No token available
  log.debug('No auth token available — replay tools will be unavailable');
  cachedToken = null;
  cachePopulated = true;
  return null;
}

/**
 * Requires a valid auth token or throws AuthTokenMissingError.
 * Call this only for operations that need the HTTP API (replay tools).
 */
export function requireAuthToken(): string {
  const token = resolveAuthToken();
  if (!token) {
    throw new AuthTokenMissingError();
  }
  return token;
}

/**
 * Invalidates the cached auth token and attempts one re-detection.
 * Called when a replay receives a 401 from HTTPToolkit, indicating the
 * token is stale (e.g., user restarted HTTPToolkit desktop).
 *
 * Returns the new token if re-detection succeeds, null otherwise.
 * After one failed re-detection, further calls return null without retrying
 * to prevent infinite 401 loops.
 */
export function invalidateTokenCache(): string | null {
  if (redetectAttempted) {
    log.debug('Re-detection already attempted — not retrying');
    return null;
  }

  log.info('Token cache invalidated — attempting re-detection');
  cachedToken = null;
  cachePopulated = false;
  redetectAttempted = true;

  return resolveAuthToken();
}

/**
 * Resets all auth state. **Test-only** — must not be called in production paths.
 * Clears the cached token, population flag, and re-detection guard.
 */
export function resetAuthState(): void {
  cachedToken = null;
  cachePopulated = false;
  redetectAttempted = false;
}
