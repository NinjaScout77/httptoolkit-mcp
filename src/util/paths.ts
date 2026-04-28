import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Returns macOS's per-user temp directory, the equivalent of confstr(_CS_DARWIN_USER_TEMP_DIR).
 *
 * os.tmpdir() reads $TMPDIR first and falls back to /tmp when it's unset.
 * GUI launchers like Claude Desktop sanitize child-process environments and
 * may not propagate $TMPDIR, so os.tmpdir() returns /tmp — wrong for our purposes.
 *
 * The reliable approach is to ask macOS directly via `getconf`, which calls
 * confstr(_CS_DARWIN_USER_TEMP_DIR) under the hood. This works regardless of
 * environment sanitization and returns the same path the OS uses for per-user
 * temporary files (e.g. /var/folders/<hash>/T/).
 */
function getDarwinUserTempDir(): string {
  if (process.env['TMPDIR']) {
    return process.env['TMPDIR'].replace(/\/$/, '');
  }
  try {
    const result = execSync('getconf DARWIN_USER_TEMP_DIR', {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return result.replace(/\/$/, '');
  } catch {
    // Last-resort fallback. May still be wrong but at least won't crash.
    return os.tmpdir();
  }
}

/**
 * Returns the Unix domain socket path for HTTPToolkit's control API.
 * Matches httptoolkit-server's socket path conventions per platform.
 */
export function getSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\httptoolkit-ctl';
  }

  if (process.platform === 'darwin') {
    return path.join(getDarwinUserTempDir(), 'httptoolkit-ctl.sock');
  }

  // Linux + others
  const xdgRuntime = process.env['XDG_RUNTIME_DIR'];
  if (xdgRuntime) {
    return path.join(xdgRuntime, 'httptoolkit-ctl.sock');
  }

  const tmpDir = os.tmpdir();
  if (tmpDir === '/tmp' || tmpDir === '/var/tmp') {
    return path.join(
      tmpDir,
      `httptoolkit-${process.getuid?.() ?? 'unknown'}`,
      'httptoolkit-ctl.sock',
    );
  }
  return path.join(tmpDir, 'httptoolkit-ctl.sock');
}

/**
 * Returns the default audit log directory path.
 */
export function getDataDir(): string {
  return path.join(os.homedir(), '.httptoolkit-mcp');
}
