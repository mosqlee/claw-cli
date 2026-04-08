import { describe, it, expect, beforeEach, vi } from 'vitest';
import { _deps, detectInstallMethod, checkForUpdate, update } from './updater.js';

// Capture console.log output
function captureLog(fn: () => Promise<void>): string[] {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(' '));
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(() => { console.log = orig; return lines; }) as unknown as string[];
    }
    console.log = orig;
    return lines;
  } catch {
    console.log = orig;
    return lines;
  }
}

async function captureLogAsync(fn: () => Promise<void>): Promise<{ lines: string[]; err?: Error }> {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(' '));
  let err: Error | undefined;
  try {
    await fn();
  } catch (e) {
    err = e as Error;
  } finally {
    console.log = orig;
  }
  return { lines, err };
}

// Save originals for restoration
const origDeps = { ..._deps };

beforeEach(() => {
  Object.assign(_deps, origDeps);
});

// ── detectInstallMethod ──

describe('detectInstallMethod', () => {
  it('returns "unknown" when no entry path', () => {
    _deps.getEntryPath = () => null;
    expect(detectInstallMethod()).toBe('unknown');
  });

  it('detects npm install via node_modules in path', () => {
    _deps.getEntryPath = () => '/usr/local/lib/node_modules/openclaw-claw/dist/cli.js';
    _deps.realpath = (p: string) => p;
    expect(detectInstallMethod()).toBe('npm');
  });

  it('detects github install via .git ancestor', () => {
    _deps.getEntryPath = () => '/home/user/claw-cli/dist/cli.js';
    _deps.realpath = (p: string) => p;
    _deps.exists = (p: string) => p === '/home/user/claw-cli/.git';
    expect(detectInstallMethod()).toBe('github');
  });

  it('returns "unknown" for path with no node_modules and no .git', () => {
    _deps.getEntryPath = () => '/opt/some/bin/claw';
    _deps.realpath = (p: string) => p;
    _deps.exists = () => false;
    expect(detectInstallMethod()).toBe('unknown');
  });
});

// ── checkForUpdate ──

describe('checkForUpdate', () => {
  const pkgJson = JSON.stringify({ name: 'openclaw-claw', version: '1.0.0' });

  beforeEach(() => {
    // Default: return v1.0.0 as current version
    _deps.readFile = () => pkgJson;
    _deps.getEntryPath = () => '/fake/path/dist/cli.js';
    _deps.realpath = (p: string) => p;
  });

  it('detects available update via npm', () => {
    _deps.exec = (cmd: string) => {
      if (cmd.includes('npm view')) return '2.0.0';
      return '';
    };
    const result = checkForUpdate('npm');
    expect(result.current).toBe('1.0.0');
    expect(result.latest).toBe('2.0.0');
    expect(result.needsUpdate).toBe(true);
  });

  it('detects already up to date via npm', () => {
    _deps.exec = () => '1.0.0';
    const result = checkForUpdate('npm');
    expect(result.needsUpdate).toBe(false);
  });

  it('detects available update via github tags', () => {
    _deps.exists = (p: string) => p.includes('.git');
    _deps.exec = () => 'abc123\trefs/tags/v3.0.0\nxyz789\trefs/tags/v2.0.0\n';
    const result = checkForUpdate('github');
    expect(result.latest).toBe('3.0.0');
    expect(result.needsUpdate).toBe(true);
  });

  it('handles github tags without v prefix', () => {
    _deps.exists = (p: string) => p.includes('.git');
    _deps.exec = () => 'abc123\trefs/tags/1.5.0\n';
    const result = checkForUpdate('github');
    expect(result.latest).toBe('1.5.0');
    expect(result.needsUpdate).toBe(true);
  });

  it('handles empty github tags output', () => {
    _deps.exists = (p: string) => p.includes('.git');
    _deps.exec = () => '';
    const result = checkForUpdate('github');
    // latest stays same as current when no tags found
    expect(result.latest).toBe('1.0.0');
    expect(result.needsUpdate).toBe(false);
  });

  it('returns "unknown" method unchanged', () => {
    const result = checkForUpdate('unknown');
    expect(result.current).toBe('1.0.0');
    expect(result.latest).toBe('1.0.0');
    expect(result.needsUpdate).toBe(false);
  });
});

// ── update (main function) ──

describe('update', () => {
  const pkgJson = JSON.stringify({ name: 'openclaw-claw', version: '1.0.0' });

  beforeEach(() => {
    _deps.readFile = () => pkgJson;
    _deps.realpath = (p: string) => p;
  });

  it('shows manual instructions for unknown install method', async () => {
    _deps.getEntryPath = () => null;
    const { lines } = await captureLogAsync(() => update());
    expect(lines).toContain('⚠️  Could not detect installation method.');
    expect(lines.some(l => l.includes('npm update -g'))).toBe(true);
  });

  it('shows already up to date when versions match', async () => {
    _deps.getEntryPath = () => '/usr/local/lib/node_modules/openclaw-claw/dist/cli.js';
    _deps.exec = () => '1.0.0';
    const { lines } = await captureLogAsync(() => update());
    expect(lines.some(l => l.includes('Already up to date'))).toBe(true);
  });

  it('shows update available but does not update with --check', async () => {
    _deps.getEntryPath = () => '/usr/local/lib/node_modules/openclaw-claw/dist/cli.js';
    _deps.exec = (cmd: string) => {
      if (cmd.includes('npm view')) return '2.0.0';
      return '';
    };
    const { lines } = await captureLogAsync(() => update({ check: true }));
    expect(lines.some(l => l.includes('Update available'))).toBe(true);
    expect(lines.some(l => l.includes('without --check'))).toBe(true);
  });

  it('performs npm update and reports success', async () => {
    _deps.getEntryPath = () => '/usr/local/lib/node_modules/openclaw-claw/dist/cli.js';
    let updateCalled = false;
    let versionCallCount = 0;
    _deps.readFile = () => {
      versionCallCount++;
      // After update is called, return new version
      if (updateCalled) {
        return JSON.stringify({ name: 'openclaw-claw', version: '2.0.0' });
      }
      return pkgJson;
    };
    _deps.exec = (cmd: string) => {
      if (cmd.includes('npm view')) return '2.0.0';
      if (cmd.includes('npm update')) {
        updateCalled = true;
        return '';
      }
      return '';
    };
    const { lines } = await captureLogAsync(() => update());
    expect(updateCalled).toBe(true);
    expect(lines.some(l => l.includes('Updated to v2.0.0'))).toBe(true);
  });

  it('reports warning when version unchanged after update', async () => {
    _deps.getEntryPath = () => '/usr/local/lib/node_modules/openclaw-claw/dist/cli.js';
    _deps.readFile = () => pkgJson; // Always returns 1.0.0
    _deps.exec = (cmd: string) => {
      if (cmd.includes('npm view')) return '2.0.0';
      return '';
    };
    const { lines } = await captureLogAsync(() => update());
    expect(lines.some(l => l.includes('Update applied but version is still'))).toBe(true);
  });

  it('throws on network failure during check', async () => {
    _deps.getEntryPath = () => '/usr/local/lib/node_modules/openclaw-claw/dist/cli.js';
    _deps.exec = () => { throw new Error('network error'); };
    const { err } = await captureLogAsync(() => update());
    expect(err).toBeDefined();
    expect(err!.message).toContain('Failed to check for updates');
  });

  it('throws when update execution fails', async () => {
    _deps.getEntryPath = () => '/usr/local/lib/node_modules/openclaw-claw/dist/cli.js';
    let callCount = 0;
    _deps.exec = (cmd: string) => {
      callCount++;
      if (cmd.includes('npm view')) return '2.0.0';
      if (cmd.includes('npm update')) throw new Error('permission denied');
      return '';
    };
    const { err } = await captureLogAsync(() => update());
    expect(err).toBeDefined();
    expect(err!.message).toContain('Update failed');
  });
});
