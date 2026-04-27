import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createRequire } from 'node:module';

import { registerServerTools } from './tools/server.js';
import { registerReadTools } from './tools/read.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { name: string; version: string };

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: pkg.name,
    version: pkg.version,
  });

  registerServerTools(server);
  registerReadTools(server);

  return server;
}
