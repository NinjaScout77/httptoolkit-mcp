import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockExecSync = vi.fn();
const mockTmpdir = vi.fn();
const mockHomedir = vi.fn().mockReturnValue('/Users/testuser');

vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    tmpdir: () => mockTmpdir(),
    homedir: () => mockHomedir(),
  };
});

// Dynamic import so mocks are in place
async function loadPaths() {
  return import('../../src/util/paths.js');
}

let originalPlatform: NodeJS.Platform;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalPlatform = process.platform;
  originalEnv = {
    TMPDIR: process.env['TMPDIR'],
    XDG_RUNTIME_DIR: process.env['XDG_RUNTIME_DIR'],
  };
  mockExecSync.mockReset();
  mockTmpdir.mockReturnValue('/tmp');
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform });
}

describe('getSocketPath', () => {
  it('macOS with TMPDIR set — uses TMPDIR without calling getconf', async () => {
    setPlatform('darwin');
    process.env['TMPDIR'] = '/var/folders/pb/3ggvz3zx4q17bk0rh1fbyccr0000gn/T/';

    const { getSocketPath } = await loadPaths();
    const result = getSocketPath();

    expect(result).toBe(
      '/var/folders/pb/3ggvz3zx4q17bk0rh1fbyccr0000gn/T/httptoolkit-ctl.sock',
    );
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('macOS without TMPDIR — falls back to getconf', async () => {
    setPlatform('darwin');
    delete process.env['TMPDIR'];

    mockExecSync.mockReturnValue('/var/folders/xx/yy/T/\n');

    const { getSocketPath } = await loadPaths();
    const result = getSocketPath();

    expect(result).toBe('/var/folders/xx/yy/T/httptoolkit-ctl.sock');
    expect(mockExecSync).toHaveBeenCalledWith(
      'getconf DARWIN_USER_TEMP_DIR',
      expect.objectContaining({ encoding: 'utf8', timeout: 1000 }),
    );
  });

  it('macOS without TMPDIR and getconf fails — falls back to os.tmpdir()', async () => {
    setPlatform('darwin');
    delete process.env['TMPDIR'];

    mockExecSync.mockImplementation(() => {
      throw new Error('getconf not found');
    });
    mockTmpdir.mockReturnValue('/tmp');

    const { getSocketPath } = await loadPaths();
    const result = getSocketPath();

    expect(result).toBe('/tmp/httptoolkit-ctl.sock');
  });

  it('Linux with XDG_RUNTIME_DIR — uses XDG path', async () => {
    setPlatform('linux');
    process.env['XDG_RUNTIME_DIR'] = '/run/user/1000';

    const { getSocketPath } = await loadPaths();
    const result = getSocketPath();

    expect(result).toBe('/run/user/1000/httptoolkit-ctl.sock');
  });

  it('Linux without XDG_RUNTIME_DIR and tmpdir=/tmp — uses namespaced path', async () => {
    setPlatform('linux');
    delete process.env['XDG_RUNTIME_DIR'];
    mockTmpdir.mockReturnValue('/tmp');

    const uidSpy = vi.spyOn(process, 'getuid').mockReturnValue(1000);

    const { getSocketPath } = await loadPaths();
    const result = getSocketPath();

    expect(result).toBe('/tmp/httptoolkit-1000/httptoolkit-ctl.sock');
    uidSpy.mockRestore();
  });

  it('Linux without XDG_RUNTIME_DIR and custom tmpdir — uses bare path', async () => {
    setPlatform('linux');
    delete process.env['XDG_RUNTIME_DIR'];
    mockTmpdir.mockReturnValue('/custom/tmp');

    const { getSocketPath } = await loadPaths();
    const result = getSocketPath();

    expect(result).toBe('/custom/tmp/httptoolkit-ctl.sock');
  });

  it('Windows — returns named pipe path', async () => {
    setPlatform('win32');

    const { getSocketPath } = await loadPaths();
    const result = getSocketPath();

    expect(result).toBe('\\\\.\\pipe\\httptoolkit-ctl');
  });
});

describe('getDataDir', () => {
  it('returns ~/.httptoolkit-mcp', async () => {
    const { getDataDir } = await loadPaths();
    const result = getDataDir();
    expect(result).toBe('/Users/testuser/.httptoolkit-mcp');
  });
});
