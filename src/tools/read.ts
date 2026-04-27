import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { executeOperation } from '../httptoolkit/bridge.js';
import { createLogger } from '../util/logger.js';

import type { EventSummary, EventOutline, EventBody } from '../types.js';

const log = createLogger('tools:read');

const DEFAULT_BODY_MAX_LENGTH = 65536; // 64KB

export function registerReadTools(server: McpServer): void {
  server.tool(
    'events_list',
    'List captured HTTP exchanges with optional filtering and pagination. ' +
      'Uses HTTPToolkit filter syntax (same as the UI search bar).',
    {
      filter: z
        .string()
        .optional()
        .describe(
          'Filter expression. Examples: "method=POST", "status>=400", "hostname*=api"',
        ),
      limit: z.number().min(1).max(100).default(20).describe('Max events to return (default 20)'),
      offset: z.number().min(0).default(0).describe('Number of events to skip (default 0)'),
    },
    async ({ filter, limit, offset }) => {
      log.debug('events_list called', { filter, limit, offset });

      try {
        const result = await executeOperation<{ total: number; events: EventSummary[] }>(
          'events.list',
          {
            ...(filter && { filter }),
            limit,
            offset,
          },
        );

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('events_list failed', { error: message });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: message }, null, 2) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'events_get',
    'Get the full outline of a captured HTTP exchange: headers, status, timing, ' +
      'body sizes — but not the body content itself. Use events_body for bodies.',
    {
      id: z.string().describe('The event ID to retrieve'),
    },
    async ({ id }) => {
      log.debug('events_get called', { id });

      try {
        const result = await executeOperation<EventOutline>('events.get-outline', { id });

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('events_get failed', { error: message });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: message }, null, 2) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'events_body',
    'Get the request or response body of a captured HTTP exchange. ' +
      'Binary content is returned as base64. Large bodies are truncated by default.',
    {
      id: z.string().describe('The event ID'),
      side: z.enum(['request', 'response']).describe('Which body to retrieve'),
      offset: z.number().min(0).default(0).describe('Character offset to start from (default 0)'),
      max_length: z
        .number()
        .min(1)
        .default(DEFAULT_BODY_MAX_LENGTH)
        .describe('Maximum characters to return (default 64KB)'),
    },
    async ({ id, side, offset, max_length }) => {
      log.debug('events_body called', { id, side, offset, max_length });

      try {
        const operation =
          side === 'request' ? 'events.get-request-body' : 'events.get-response-body';

        const args: Record<string, unknown> = { id };
        if (offset > 0) args['offset'] = offset;
        if (max_length !== DEFAULT_BODY_MAX_LENGTH) args['maxLength'] = max_length;

        const result = await executeOperation<EventBody>(operation, args);

        // Detect binary content: check for non-printable bytes
        const body = result.body;
        const isBinary = hasBinaryContent(body);

        const output: Record<string, unknown> = {
          body: isBinary ? Buffer.from(body).toString('base64') : body,
          encoding: isBinary ? 'base64' : 'utf-8',
          totalSize: result.totalSize,
          isTruncated: result.isTruncated,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('events_body failed', { error: message });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: message }, null, 2) }],
          isError: true,
        };
      }
    },
  );
}

/**
 * Detects binary content by scanning for non-printable bytes.
 * Returns true if any byte is outside the printable ASCII range
 * (excluding common whitespace: \t, \n, \r).
 */
function hasBinaryContent(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x09 || (code > 0x0d && code < 0x20) || code === 0x7f) {
      return true;
    }
  }
  return false;
}
