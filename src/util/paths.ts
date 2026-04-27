import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Returns the Unix domain socket path for HTTPToolkit's control API.
 * This matches the logic in httptoolkit-server's ui-operation-bridge.ts.
 */
export function getSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\httptoolkit-ctl';
  }

  const xdgRuntime = process.env['XDG_RUNTIME_DIR'];
  if (process.platform === 'linux' && xdgRuntime) {
    return path.join(xdgRuntime, 'httptoolkit-ctl.sock');
  }

  const tmpDir = os.tmpdir();
  if (tmpDir === '/tmp' || tmpDir === '/var/tmp') {
    // Match httptoolkit-server's behavior: /tmp/httptoolkit-<uid>/httptoolkit-ctl.sock
    return path.join(tmpDir, `httptoolkit-${process.getuid?.() ?? 'unknown'}`, 'httptoolkit-ctl.sock');
  }

  return path.join(tmpDir, 'httptoolkit-ctl.sock');
}

/**
 * Returns the default audit log directory path.
 */
export function getDataDir(): string {
  return path.join(os.homedir(), '.httptoolkit-mcp');
}
