#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { name: string; version: string };

const server = new McpServer({
  name: pkg.name,
  version: pkg.version,
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  console.error(`httptoolkit-mcp v${pkg.version} starting`);
  await server.connect(transport);
  console.error('httptoolkit-mcp connected via stdio');
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
