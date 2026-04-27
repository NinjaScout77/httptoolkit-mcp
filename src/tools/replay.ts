import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

import { requireAuthToken } from '../httptoolkit/auth.js';
import { executeOperation } from '../httptoolkit/bridge.js';
import { sendRequest, probeUpstream } from '../httptoolkit/send.js';
import { applyMutations } from '../core/mutations.js';
import { checkHost } from '../core/allowlist.js';
import { acquire } from '../core/ratelimit.js';
import { recordReplay } from '../core/audit.js';
import { createLogger } from '../util/logger.js';

import type { EventOutline, EventBody, SendOptions, AuditEntry } from '../types.js';

const log = createLogger('tools:replay');

let burpProbeLogged = false;

export function registerReplayTools(server: McpServer): void {
  server.tool(
    'replay_request',
    'Replay a previously captured HTTP request with optional mutations. ' +
      'Requires HTK_SERVER_TOKEN for authentication.',
    {
      event_id: z.string().describe('ID of the captured event to replay'),
      mutations: z
        .record(z.unknown())
        .optional()
        .describe(
          'Mutations to apply. Keys: headers.<name>, url.path, url.path.<n>, ' +
            'url.query.<name>, url.host, method, body.raw, body.<json_path>',
        ),
      description: z
        .string()
        .describe('Free-text description for the audit log (required)'),
      ignore_https_errors: z
        .union([z.boolean(), z.array(z.string())])
        .optional()
        .describe('Ignore HTTPS certificate errors (true, or array of hostnames)'),
    },
    async ({ event_id, mutations, description, ignore_https_errors }) => {
      log.debug('replay_request called', { event_id, mutations, description });

      try {
        const authToken = requireAuthToken();

        // 1. Fetch original request
        const outline = await executeOperation<EventOutline>('events.get-outline', {
          id: event_id,
        });

        const bodyResult = await executeOperation<EventBody>('events.get-request-body', {
          id: event_id,
        });

        // Build the mutable request from the outline
        const headers: Array<[string, string]> = [];
        if (outline.request.headers) {
          for (const [name, value] of Object.entries(outline.request.headers)) {
            if (Array.isArray(value)) {
              for (const v of value) {
                headers.push([name, v]);
              }
            } else {
              headers.push([name, value]);
            }
          }
        }

        let request = {
          method: outline.request.method,
          url: outline.request.url,
          headers,
          rawBody: bodyResult.body,
        };

        // 2. Apply mutations
        if (mutations && Object.keys(mutations).length > 0) {
          request = applyMutations(request, mutations);
        }

        // 3. Check allowlist
        const allowlistResult = checkHost(request.url);
        if (!allowlistResult.allowed) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  { error: 'OutOfScope', message: allowlistResult.reason },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        // 4. Rate limit
        const targetHost = new URL(request.url).host;
        await acquire(targetHost);

        // 5. Build send options
        const sendOptions: SendOptions = {};

        if (ignore_https_errors !== undefined) {
          sendOptions.ignoreHostHttpsErrors = ignore_https_errors;
        }

        const burpUpstream = process.env['BURP_UPSTREAM'];
        if (burpUpstream) {
          if (!burpProbeLogged) {
            const reachable = await probeUpstream(burpUpstream);
            if (reachable) {
              log.info(`Burp upstream reachable at ${burpUpstream}`);
            } else {
              log.warn(`Burp upstream unreachable at ${burpUpstream} — replays may fail`);
            }
            burpProbeLogged = true;
          }
          sendOptions.proxyConfig = { proxyUrl: burpUpstream };
        }

        // 6. Send
        const result = await sendRequest(
          {
            method: request.method,
            url: request.url,
            headers: request.headers,
            rawBody: request.rawBody,
          },
          sendOptions,
          authToken,
        );

        // 7. Audit
        const replayId = randomUUID();
        const auditEntry: AuditEntry = {
          timestamp: new Date().toISOString(),
          replay_id: replayId,
          source_event_id: event_id,
          mutations: mutations ?? null,
          target_url: request.url,
          response_status: result.status,
          response_size: result.body.length,
          finding_id: null,
          description,
        };
        await recordReplay(auditEntry);

        // 8. Return result
        const bodyStr = result.body.toString('utf-8');
        const truncated = bodyStr.length > 65536;
        const output = {
          status: result.status,
          headers: result.headers,
          body: truncated ? bodyStr.slice(0, 65536) : bodyStr,
          body_truncated: truncated,
          body_size: result.body.length,
          timing: result.timing,
          replay_id: replayId,
          audit_id: replayId,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string }).code ?? 'UNKNOWN';
        log.error('replay_request failed', { error: message, code });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: code, message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'replay_raw',
    'Send an arbitrary HTTP request through HTTPToolkit. ' +
      'Requires HTK_SERVER_TOKEN for authentication.',
    {
      method: z.string().describe('HTTP method (GET, POST, PUT, DELETE, etc.)'),
      url: z.string().url().describe('Full target URL'),
      headers: z
        .array(z.tuple([z.string(), z.string()]))
        .optional()
        .describe('Request headers as [name, value] pairs'),
      body: z.string().optional().describe('Request body'),
      body_encoding: z
        .enum(['utf-8', 'base64'])
        .default('utf-8')
        .describe('Body encoding (default utf-8)'),
      description: z
        .string()
        .describe('Free-text description for the audit log (required)'),
      ignore_https_errors: z
        .union([z.boolean(), z.array(z.string())])
        .optional()
        .describe('Ignore HTTPS certificate errors'),
    },
    async ({ method, url, headers, body, body_encoding, description, ignore_https_errors }) => {
      log.debug('replay_raw called', { method, url, description });

      try {
        const authToken = requireAuthToken();

        // 1. Check allowlist
        const allowlistResult = checkHost(url);
        if (!allowlistResult.allowed) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  { error: 'OutOfScope', message: allowlistResult.reason },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        // 2. Rate limit
        const targetHost = new URL(url).host;
        await acquire(targetHost);

        // 3. Build request
        const rawBody =
          body_encoding === 'base64' && body ? Buffer.from(body, 'base64').toString() : (body ?? '');

        // 4. Build send options
        const sendOptions: SendOptions = {};

        if (ignore_https_errors !== undefined) {
          sendOptions.ignoreHostHttpsErrors = ignore_https_errors;
        }

        const burpUpstream = process.env['BURP_UPSTREAM'];
        if (burpUpstream) {
          sendOptions.proxyConfig = { proxyUrl: burpUpstream };
        }

        // 5. Send
        const result = await sendRequest(
          {
            method,
            url,
            headers: headers ?? [],
            rawBody,
          },
          sendOptions,
          authToken,
        );

        // 6. Audit
        const replayId = randomUUID();
        const auditEntry: AuditEntry = {
          timestamp: new Date().toISOString(),
          replay_id: replayId,
          source_event_id: null,
          mutations: null,
          target_url: url,
          response_status: result.status,
          response_size: result.body.length,
          finding_id: null,
          description,
        };
        await recordReplay(auditEntry);

        // 7. Return result
        const bodyStr = result.body.toString('utf-8');
        const truncated = bodyStr.length > 65536;
        const output = {
          status: result.status,
          headers: result.headers,
          body: truncated ? bodyStr.slice(0, 65536) : bodyStr,
          body_truncated: truncated,
          body_size: result.body.length,
          timing: result.timing,
          replay_id: replayId,
          audit_id: replayId,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string }).code ?? 'UNKNOWN';
        log.error('replay_raw failed', { error: message, code });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: code, message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
