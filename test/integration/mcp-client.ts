import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import * as path from 'node:path';

export interface McpResponse {
  jsonrpc: string;
  id?: number;
  result?: {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
    [key: string]: unknown;
  };
  error?: { code: number; message: string; data?: unknown };
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export class McpClient {
  private proc: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();

  async start(env: Record<string, string> = {}): Promise<void> {
    const distIndex = path.resolve(process.cwd(), 'dist', 'index.js');

    // Merge env, deleting keys with empty string values
    const mergedEnv: Record<string, string> = { ...process.env } as Record<string, string>;
    for (const [key, value] of Object.entries(env)) {
      if (value === '') {
        delete mergedEnv[key];
      } else {
        mergedEnv[key] = value;
      }
    }

    this.proc = spawn('node', [distIndex], {
      env: mergedEnv,
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    this.rl = readline.createInterface({ input: this.proc.stdout! });
    this.rl.on('line', (line: string) => {
      try {
        const msg = JSON.parse(line) as McpResponse;
        if (msg.id != null && this.pending.has(msg.id)) {
          const handler = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) handler.reject(msg.error);
          else handler.resolve(msg.result);
        }
      } catch {
        // Not JSON, ignore (stderr or noise)
      }
    });

    this.proc.on('error', (err: Error) => {
      console.error('MCP process error:', err.message);
    });

    // MCP handshake
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'verify-harness', version: '1.0.0' },
    });
    await this.notify('notifications/initialized');
  }

  async request(method: string, params: unknown): Promise<unknown> {
    if (!this.proc?.stdin) throw new Error('MCP client not started');

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      this.proc!.stdin!.write(msg + '\n');
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout waiting for ${method} (id=${id})`));
        }
      }, 15000);
    });
  }

  async notify(method: string, params: unknown = {}): Promise<void> {
    if (!this.proc?.stdin) throw new Error('MCP client not started');
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.proc.stdin.write(msg + '\n');
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const result = (await this.request('tools/call', { name, arguments: args })) as ToolResult;
    return result;
  }

  async stop(): Promise<void> {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}
