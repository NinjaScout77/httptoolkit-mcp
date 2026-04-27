import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { OperationFailedError, ProRequiredError } from '../../src/core/errors.js';

// Mock socketRequest before importing bridge
const mockSocketRequest = vi.fn();
vi.mock('../../src/httptoolkit/client.js', () => ({
  socketRequest: (...args: unknown[]) => mockSocketRequest(...args),
}));

// Import after mocking
const { executeOperation, resetOperationsCache } = await import(
  '../../src/httptoolkit/bridge.js'
);

describe('bridge.executeOperation', () => {
  beforeEach(() => {
    resetOperationsCache();
    mockSocketRequest.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws OperationFailedError for non-Pro operation failures', async () => {
    mockSocketRequest.mockResolvedValue({
      success: false,
      error: { message: 'Invalid arguments for operation', code: 'INVALID_ARGS' },
    });

    await expect(executeOperation('events.list', {})).rejects.toThrow(OperationFailedError);

    try {
      await executeOperation('events.list', {});
    } catch (err) {
      const opErr = err as OperationFailedError;
      expect(opErr.operation).toBe('events.list');
      expect(opErr.upstreamMessage).toBe('Invalid arguments for operation');
      expect(opErr.upstreamCode).toBe('INVALID_ARGS');
      expect(opErr.code).toBe('OPERATION_FAILED');
    }
  });

  it('throws ProRequiredError when upstream message mentions Pro', async () => {
    mockSocketRequest.mockResolvedValue({
      success: false,
      error: { message: 'This feature requires Pro subscription' },
    });

    await expect(executeOperation('interceptors.activate', {})).rejects.toThrow(ProRequiredError);

    try {
      await executeOperation('interceptors.activate', {});
    } catch (err) {
      const proErr = err as ProRequiredError;
      expect(proErr.operation).toBe('interceptors.activate');
      expect(proErr.code).toBe('PRO_REQUIRED');
    }
  });

  it('returns data on successful operation', async () => {
    mockSocketRequest.mockResolvedValue({
      success: true,
      data: { port: 8080 },
    });

    const result = await executeOperation<{ port: number }>('proxy.get-config', {});
    expect(result).toEqual({ port: 8080 });
  });
});
