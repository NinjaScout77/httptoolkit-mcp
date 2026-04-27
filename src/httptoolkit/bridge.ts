import type { ExecuteResult, Operation } from '../types.js';
import { createLogger } from '../util/logger.js';
import { socketRequest } from './client.js';

const log = createLogger('bridge');

let cachedOperations: Operation[] | null = null;

/**
 * Lists available operations from HTTPToolkit's API bridge.
 * Uses the Unix socket — no auth required.
 * Caches on first call (operations don't change within a session).
 */
export async function listOperations(): Promise<Operation[]> {
  if (cachedOperations) {
    return cachedOperations;
  }

  log.debug('Fetching operations list via socket');
  const operations = await socketRequest<Operation[]>('GET', '/api/operations');
  cachedOperations = operations;
  log.info(`Loaded ${operations.length} operations from HTTPToolkit`);
  return operations;
}

/**
 * Executes an operation via HTTPToolkit's API bridge.
 * Uses the Unix socket — no auth required.
 *
 * @param name - Operation name (e.g., "events.list", "proxy.get-config")
 * @param args - Operation arguments
 * @returns The operation result data
 */
export async function executeOperation<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  log.debug(`Executing operation: ${name}`, args);

  const result = await socketRequest<ExecuteResult<T>>('POST', '/api/execute', {
    name,
    args,
    source: 'mcp',
  });

  if (result && !result.success && result.error) {
    throw new Error(`Operation ${name} failed: ${result.error.message}`);
  }

  return result.data as T;
}

/**
 * Checks if HTTPToolkit is running and ready.
 */
export async function checkStatus(): Promise<{ ready: boolean }> {
  return socketRequest<{ ready: boolean }>('GET', '/api/status');
}

/**
 * Resets the cached operations list (for testing).
 */
export function resetOperationsCache(): void {
  cachedOperations = null;
}
