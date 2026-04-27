/**
 * NOTE: As of httptoolkit-mcp 0.1.0, the `/client/send` request/response format
 * has NOT been verified end-to-end with a real auth token. The encoding details
 * here (base64 rawBody on request, base64 rawBody on response-body-part) are
 * inferred from reading httptoolkit-server source. If you encounter garbled
 * response bodies or send failures, please open an issue with the captured
 * NDJSON stream.
 *
 * Tracking: https://github.com/NinjaScout77/httptoolkit-mcp/issues/7
 */

import { request as undiciRequest } from 'undici';
import type { Readable } from 'node:stream';
import * as readline from 'node:readline';
import * as net from 'node:net';

import { HttpToolkitError } from '../core/errors.js';
import { createLogger } from '../util/logger.js';

import type { SendRequest, SendOptions, SendResult, SendEvent } from '../types.js';

const log = createLogger('send');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_API_PORT = 45457;
const DEFAULT_ORIGIN = 'https://app.httptoolkit.tech';

/**
 * Sends a request through HTTPToolkit's /client/send endpoint.
 * This is HTTP-only (port 45457) and requires an auth token.
 *
 * The request rawBody must be base64-encoded.
 * Response body parts in the NDJSON stream are also base64-encoded.
 */
export async function sendRequest(
  request: SendRequest,
  options: SendOptions,
  authToken: string,
): Promise<SendResult> {
  const host = process.env['HTK_SERVER_HOST'] ?? DEFAULT_HOST;
  const port = parseInt(process.env['HTK_API_PORT'] ?? String(DEFAULT_API_PORT), 10);
  const url = `http://${host}:${port}/client/send`;

  // Encode rawBody as base64 for the API
  const rawBodyBase64 =
    typeof request.rawBody === 'string'
      ? Buffer.from(request.rawBody).toString('base64')
      : request.rawBody.toString('base64');

  const body = {
    request: {
      method: request.method,
      url: request.url,
      headers: request.headers,
      rawBody: rawBodyBase64,
    },
    options: {
      ...options,
    },
  };

  log.debug('Sending request via /client/send', { method: request.method, url: request.url });

  const response = await undiciRequest(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      Origin: DEFAULT_ORIGIN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (response.statusCode >= 400) {
    const text = await response.body.text();
    throw new HttpToolkitError(
      `Send request failed: HTTP ${response.statusCode}`,
      response.statusCode,
      text,
    );
  }

  // Parse NDJSON stream
  return parseNdjsonStream(response.body as unknown as Readable);
}

async function parseNdjsonStream(stream: Readable): Promise<SendResult> {
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let status = 0;
  let headers: Record<string, string | string[]> = {};
  const bodyParts: Buffer[] = [];
  let startTime = Date.now();
  let endTime = startTime;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: SendEvent;
    try {
      event = JSON.parse(trimmed) as SendEvent;
    } catch {
      log.warn('Failed to parse NDJSON line', { line: trimmed });
      continue;
    }

    switch (event.type) {
      case 'request-start':
        startTime = Date.now();
        break;

      case 'response-head':
        status = (event['statusCode'] as number) ?? 0;
        headers = (event['headers'] as Record<string, string | string[]>) ?? {};
        break;

      case 'response-body-part': {
        const rawBody = event['rawBody'] as string | undefined;
        if (rawBody) {
          bodyParts.push(Buffer.from(rawBody, 'base64'));
        }
        break;
      }

      case 'response-end':
        endTime = Date.now();
        break;

      case 'error': {
        const message = (event['message'] as string) ?? 'Unknown send error';
        throw new HttpToolkitError(message, 0, event);
      }
    }
  }

  return {
    status,
    headers,
    body: Buffer.concat(bodyParts),
    timing: {
      startTime,
      endTime,
      durationMs: endTime - startTime,
    },
  };
}

/**
 * TCP-probes a host:port to check if it's reachable.
 * Used to check Burp upstream availability on startup.
 */
export function probeUpstream(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const port = parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), 10);

      const socket = net.createConnection({ host: parsed.hostname, port, timeout: 3000 });
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}
