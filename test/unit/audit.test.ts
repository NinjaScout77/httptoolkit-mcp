import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import type { AuditEntry } from '../../src/types.js';
import { recordReplay } from '../../src/core/audit.js';

function makeEntry(overrides?: Partial<AuditEntry>): AuditEntry {
  return {
    timestamp: '2026-04-27T00:00:00.000Z',
    replay_id: 'replay-001',
    source_event_id: 'evt-123',
    mutations: null,
    target_url: 'https://api.example.com/users',
    response_status: 200,
    response_size: 1024,
    finding_id: null,
    description: 'test replay',
    ...overrides,
  };
}

describe('audit', () => {
  let tmpDir: string;
  const originalAuditPath = process.env['AUDIT_LOG_PATH'];

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-test-'));
    process.env['AUDIT_LOG_PATH'] = path.join(tmpDir, 'audit.jsonl');
  });

  afterEach(async () => {
    if (originalAuditPath !== undefined) {
      process.env['AUDIT_LOG_PATH'] = originalAuditPath;
    } else {
      delete process.env['AUDIT_LOG_PATH'];
    }
    // Clean up temp files
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('writes a JSONL line to the configured path', async () => {
    const entry = makeEntry();
    await recordReplay(entry);

    const content = await fsp.readFile(process.env['AUDIT_LOG_PATH']!, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]!);
    expect(parsed.replay_id).toBe('replay-001');
    expect(parsed.target_url).toBe('https://api.example.com/users');
  });

  it('appends multiple entries as separate lines', async () => {
    await recordReplay(makeEntry({ replay_id: 'r1' }));
    await recordReplay(makeEntry({ replay_id: 'r2' }));
    await recordReplay(makeEntry({ replay_id: 'r3' }));

    const content = await fsp.readFile(process.env['AUDIT_LOG_PATH']!, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3);
  });

  it('creates directory if missing', async () => {
    const deepPath = path.join(tmpDir, 'nested', 'deep', 'audit.jsonl');
    process.env['AUDIT_LOG_PATH'] = deepPath;

    await recordReplay(makeEntry());

    const content = await fsp.readFile(deepPath, 'utf-8');
    expect(content.trim()).toBeTruthy();
  });

  it('handles write errors gracefully — logs but does not throw', async () => {
    // Point to a path that will fail (directory as file)
    const badPath = path.join(tmpDir, 'baddir');
    await fsp.mkdir(badPath);
    // Set audit path to a "file" that is actually a directory
    process.env['AUDIT_LOG_PATH'] = badPath;

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Should not throw
    await expect(recordReplay(makeEntry())).resolves.toBeUndefined();

    // Should have logged an error
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('failed to write audit log');

    stderrSpy.mockRestore();
  });

  it('respects AUDIT_LOG_PATH env override', async () => {
    const customPath = path.join(tmpDir, 'custom-audit.jsonl');
    process.env['AUDIT_LOG_PATH'] = customPath;

    await recordReplay(makeEntry());

    const content = await fsp.readFile(customPath, 'utf-8');
    expect(content.trim()).toBeTruthy();
  });
});
