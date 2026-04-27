import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createRequire } from 'node:module';

import { executeOperation, checkStatus } from '../httptoolkit/bridge.js';
import { resolveAuthToken } from '../httptoolkit/auth.js';
import { createLogger } from '../util/logger.js';

import type { ProxyConfig, Interceptor } from '../types.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };
const log = createLogger('tools:server');

export function registerServerTools(server: McpServer): void {
  server.tool(
    'server_status',
    'Get HTTPToolkit server status: proxy config, connection status, and MCP version',
    {},
    async () => {
      log.debug('server_status called');

      try {
        const status = await checkStatus();
        if (!status.ready) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  { ready: false, error: 'HTTPToolkit is not ready' },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const config = await executeOperation<ProxyConfig>('proxy.get-config');

        const authToken = resolveAuthToken();
        const burpUpstream = process.env['BURP_UPSTREAM'] ?? null;

        const result = {
          ready: true,
          httpProxyPort: config.httpProxyPort,
          certPath: config.certPath,
          certFingerprint: config.certFingerprint,
          externalNetworkAddresses: config.externalNetworkAddresses,
          tier: 'unknown' as const,
          replayAvailable: authToken !== null,
          upstreamProxy: burpUpstream ? { url: burpUpstream } : null,
          version: pkg.version,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('server_status failed', { error: message });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'interceptors_list',
    'List available HTTPToolkit interceptors and their current status',
    {},
    async () => {
      log.debug('interceptors_list called');

      try {
        const result = await executeOperation<{ interceptors: Interceptor[] }>(
          'interceptors.list',
        );

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('interceptors_list failed', { error: message });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
