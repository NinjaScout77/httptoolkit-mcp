import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import type { AuditEntry } from '../types.js';
import { createLogger } from '../util/logger.js';
import { getDataDir } from '../util/paths.js';

const logger = createLogger('audit');

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

function getAuditLogPath(): string {
  const override = process.env['AUDIT_LOG_PATH'];
  if (override && override.trim() !== '') {
    return override.trim();
  }
  return path.join(getDataDir(), 'audit.jsonl');
}

async function ensureDirectory(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });
}

async function rotateIfNeeded(filePath: string): Promise<void> {
  try {
    const stat = await fsp.stat(filePath);
    if (stat.size >= MAX_FILE_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedPath = `${filePath}.${timestamp}`;
      await fsp.rename(filePath, rotatedPath);
      logger.info(`rotated audit log to ${rotatedPath}`);
    }
  } catch (err: unknown) {
    // File doesn't exist yet — nothing to rotate
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw err;
  }
}

/**
 * Records a replay audit entry as a JSONL line.
 * Non-blocking: failures are logged to stderr but never propagated.
 */
export async function recordReplay(entry: AuditEntry): Promise<void> {
  try {
    const filePath = getAuditLogPath();
    await ensureDirectory(filePath);
    await rotateIfNeeded(filePath);

    const line = JSON.stringify(entry) + '\n';
    await fsp.appendFile(filePath, line, 'utf-8');
  } catch (err: unknown) {
    logger.error('failed to write audit log', err instanceof Error ? err.message : String(err));
  }
}
