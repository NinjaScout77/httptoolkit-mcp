import * as http from 'node:http';

import { request as undiciRequest } from 'undici';

import { HttpToolkitError, ProRequiredError, SocketConnectionError } from '../core/errors.js';
import { createLogger } from '../util/logger.js';
import { getSocketPath } from '../util/paths.js';

const log = createLogger('client');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_API_PORT = 45457;
const DEFAULT_ORIGIN = 'https://app.httptoolkit.tech';
const NETWORK_RETRY_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOENT']);

/**
 * Makes an HTTP request via the Unix domain socket (no auth required).
 * Used for all read operations via /api/operations, /api/execute, /api/status.
 */
export async function socketRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const socketPath = getSocketPath();

  return new Promise<T>((resolve, reject) => {
    const req = http.request(
      {
        method,
        path,
        socketPath,
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', (err) => reject(err));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          const status = res.statusCode ?? 500;

          if (status >= 400) {
            try {
              const parsed = JSON.parse(raw) as Record<string, unknown>;
              const message =
                typeof parsed['error'] === 'string'
                  ? parsed['error']
                  : (parsed['error'] as Record<string, unknown>)?.['message'] ?? `HTTP ${status}`;
              reject(new HttpToolkitError(String(message), status, parsed));
            } catch {
              reject(new HttpToolkitError(`HTTP ${status}: ${raw}`, status, raw));
            }
            return;
          }

          try {
            resolve(JSON.parse(raw) as T);
          } catch {
            reject(new HttpToolkitError(`Unparseable response: ${raw}`, status, raw));
          }
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error('Socket request timed out'));
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOENT') {
        reject(new SocketConnectionError(socketPath));
      } else {
        reject(err);
      }
    });

    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Makes an HTTP request to the HTTPToolkit REST API (port 45457).
 * Requires auth token. Used for /client/send and other HTTP-only endpoints.
 * Retries once on network errors (ECONNREFUSED, ETIMEDOUT).
 */
export async function httpRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  authToken: string,
  body?: unknown,
): Promise<T> {
  const host = process.env['HTK_SERVER_HOST'] ?? DEFAULT_HOST;
  const port = parseInt(process.env['HTK_API_PORT'] ?? String(DEFAULT_API_PORT), 10);
  const url = `http://${host}:${port}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${authToken}`,
    Origin: DEFAULT_ORIGIN,
    'Content-Type': 'application/json',
  };

  const doRequest = async (): Promise<T> => {
    const response = await undiciRequest(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const status = response.statusCode;

    if (status >= 400) {
      const text = await response.body.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }

      const message =
        typeof parsed === 'object' && parsed !== null
          ? ((parsed as Record<string, unknown>)['error'] as Record<string, unknown>)?.['message'] ??
            `HTTP ${status}`
          : `HTTP ${status}: ${text}`;

      // Detect Pro-required errors
      if (status === 403 && typeof message === 'string' && /pro/i.test(message)) {
        throw new ProRequiredError(path);
      }

      throw new HttpToolkitError(String(message), status, parsed);
    }

    const text = await response.body.text();
    return JSON.parse(text) as T;
  };

  try {
    return await doRequest();
  } catch (err) {
    const errCode = (err as NodeJS.ErrnoException).code;
    if (errCode && NETWORK_RETRY_CODES.has(errCode)) {
      log.warn(`Network error (${errCode}), retrying once...`);
      return doRequest();
    }
    throw err;
  }
}

/**
 * Makes an HTTP request that returns a raw response stream (for NDJSON).
 * Used by /client/send.
 */
export async function httpRequestStream(
  method: 'POST',
  path: string,
  authToken: string,
  body: unknown,
): Promise<{ statusCode: number; body: import('stream').Readable }> {
  const host = process.env['HTK_SERVER_HOST'] ?? DEFAULT_HOST;
  const port = parseInt(process.env['HTK_API_PORT'] ?? String(DEFAULT_API_PORT), 10);
  const url = `http://${host}:${port}${path}`;

  const response = await undiciRequest(url, {
    method,
    headers: {
      Authorization: `Bearer ${authToken}`,
      Origin: DEFAULT_ORIGIN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  // undici returns a Readable body
  return {
    statusCode: response.statusCode,
    body: response.body as unknown as import('stream').Readable,
  };
}
