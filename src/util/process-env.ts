import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createLogger } from './logger.js';

const log = createLogger('process-env');

/**
 * Returns the path to the prebuilt htk-getenv binary for the current platform,
 * or null if no binary is available for this platform/arch combination.
 */
export function getNativeBinaryPath(): string | null {
  const platform = process.platform;
  const arch = process.arch;

  // Map Node.js platform/arch to our prebuild directory names
  const dirName = `${platform}-${arch}`;

  // Resolve relative to this file's location in the package
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const binaryPath = path.resolve(thisDir, '..', '..', 'prebuilds', dirName, 'htk-getenv');

  try {
    fs.accessSync(binaryPath, fs.constants.X_OK);
    return binaryPath;
  } catch {
    log.debug(`No prebuilt binary for ${dirName} at ${binaryPath}`);
    return null;
  }
}

/**
 * Reads an environment variable from another process using the platform-specific
 * native helper binary.
 *
 * macOS: Uses sysctl(KERN_PROCARGS2) — reads the immutable OS-level env.
 * Linux: Uses /proc/<pid>/environ — reads the initial process environment.
 *
 * Returns null on any error (process not found, permission denied, var not found,
 * binary missing, unsupported platform). Never throws.
 */
export function getEnvVarFromPid(pid: number, varName: string): string | null {
  const binaryPath = getNativeBinaryPath();
  if (!binaryPath) {
    return null;
  }

  try {
    const result = execFileSync(binaryPath, [String(pid), varName], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const value = result.trim();
    return value.length > 0 ? value : null;
  } catch {
    // Exit code 1 = not found, or any other error (permission, timeout)
    return null;
  }
}

/**
 * Finds the PID of the running HTTPToolkit Server process.
 * Returns null if no server is detected.
 *
 * Uses `pgrep` to search for the process title "HTTP Toolkit Server"
 * which is set by httptoolkit-server/src/commands/start.js.
 */
export function findServerPid(): number | null {
  try {
    const output = execFileSync('pgrep', ['-f', 'HTTP Toolkit Server'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const pids = output
      .trim()
      .split('\n')
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n) && n > 0);

    if (pids.length === 0) {
      return null;
    }

    if (pids.length > 1) {
      log.warn(`Multiple HTTPToolkit Server processes found (PIDs: ${pids.join(', ')}), using first`);
    }

    return pids[0] ?? null;
  } catch {
    // pgrep exits 1 when no match found
    return null;
  }
}

/**
 * Attempts to auto-detect the HTK_SERVER_TOKEN from a running HTTPToolkit desktop app.
 *
 * Steps:
 * 1. Find the HTTPToolkit Server process via pgrep
 * 2. Read HTK_SERVER_TOKEN from its OS-level environment via native helper
 *
 * Returns null if detection fails at any step. Never throws.
 */
export function autoDetectToken(): string | null {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    log.debug(`Auto-detection not supported on ${process.platform}`);
    return null;
  }

  const pid = findServerPid();
  if (pid === null) {
    log.debug('No HTTPToolkit Server process found');
    return null;
  }

  log.debug(`Found HTTPToolkit Server at PID ${pid}`);

  const token = getEnvVarFromPid(pid, 'HTK_SERVER_TOKEN');
  if (token) {
    log.debug('Auto-detected HTK_SERVER_TOKEN from running server');
    return token;
  }

  log.debug('HTK_SERVER_TOKEN not found in server process environment');
  return null;
}
