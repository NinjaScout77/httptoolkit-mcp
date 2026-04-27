import { AuthTokenMissingError } from '../core/errors.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('auth');

/**
 * Resolves the HTTPToolkit server auth token.
 *
 * The token is ephemeral — generated per session by the Electron desktop app
 * and passed to the server via HTK_SERVER_TOKEN. There is no file-based token.
 *
 * This token is only needed for HTTP API calls (replay tools).
 * The Unix socket (used for read tools) does not require auth.
 */
export function resolveAuthToken(): string | null {
  const token = process.env['HTK_SERVER_TOKEN']?.trim();
  if (token && token.length > 0) {
    log.debug('Auth token resolved from HTK_SERVER_TOKEN env var');
    return token;
  }

  log.debug('No HTK_SERVER_TOKEN set — replay tools will be unavailable');
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
