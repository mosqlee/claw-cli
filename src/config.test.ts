import { describe, it, expect, beforeEach, vi } from 'vitest';
import { _deps, getConfig, setConfig, showConfig } from './config.js';

const origDeps = { ..._deps };
let writtenData: Record<string, unknown> | null = null;

beforeEach(() => {
  Object.assign(_deps, origDeps);
  writtenData = null;
});

async function captureLog(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = orig; }
  return lines;
}

describe('getConfig', () => {
  it('returns default config when file missing', async () => {
    _deps.readJson = async () => { throw new Error('ENOENT'); };
    const config = await getConfig();
    expect(config).toEqual(_deps.defaultConfig());
  });

  it('merges file config with defaults', async () => {
    _deps.readJson = async () => ({ registry: 'git@custom:url.git', skillsRepo: 'custom-url' });
    const config = await getConfig();
    expect(config.registry).toBe('git@custom:url.git');
    expect(config.skillsRepo).toBe('custom-url');
    // defaults still present for keys not overridden
    expect(config.skillsRepo).toBeDefined();
  });

  it('returns default config for invalid JSON', async () => {
    _deps.readJson = async () => { throw new SyntaxError('Unexpected token'); };
    const config = await getConfig();
    expect(config).toEqual(_deps.defaultConfig());
  });
});

describe('setConfig', () => {
  it('writes new key to config', async () => {
    _deps.readJson = async () => ({ registry: 'default' });
    _deps.writeJson = async (_p: string, data: unknown) => { writtenData = data as Record<string, unknown>; };
    _deps.ensureDir = async () => {};
    _deps.configFile = () => '/fake/config.json';

    await setConfig('newKey', 'newValue');
    expect(writtenData).not.toBeNull();
    expect((writtenData as Record<string, unknown>).newKey).toBe('newValue');
    expect((writtenData as Record<string, unknown>).registry).toBe('default');
  });

  it('overwrites existing key', async () => {
    _deps.readJson = async () => ({ registry: 'old', other: 'keep' });
    _deps.writeJson = async (_p: string, data: unknown) => { writtenData = data as Record<string, unknown>; };
    _deps.ensureDir = async () => {};
    _deps.configFile = () => '/fake/config.json';

    await setConfig('registry', 'new');
    expect((writtenData as Record<string, unknown>).registry).toBe('new');
    expect((writtenData as Record<string, unknown>).other).toBe('keep');
  });
});

describe('showConfig', () => {
  it('prints config entries', async () => {
    _deps.readJson = async () => ({ registry: 'test-url', foo: 'bar' });
    const lines = await captureLog(() => showConfig());
    expect(lines.some(l => l.includes('registry'))).toBe(true);
    expect(lines.some(l => l.includes('test-url'))).toBe(true);
    expect(lines.some(l => l.includes('foo'))).toBe(true);
  });
});
