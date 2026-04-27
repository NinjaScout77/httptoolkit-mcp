#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createRequire } from 'node:module';

import { createMcpServer } from './server.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  const server = createMcpServer();

  process.stderr.write(`httptoolkit-mcp v${pkg.version} starting\n`);
  await server.connect(transport);
  process.stderr.write('httptoolkit-mcp connected via stdio\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal error: ${error}\n`);
  process.exit(1);
});
