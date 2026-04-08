import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { getConfig, setConfig, _deps } from '../src/config.js';

const TMP = path.join(os.tmpdir(), 'claw-integ-config-' + Date.now());
const CONFIG_PATH = path.join(TMP, 'config.json');

// Redirect config file path for integration tests
const origConfigFile = _deps.configFile;
const origEnsureDir = _deps.ensureDir;

beforeEach(async () => {
  await fs.ensureDir(TMP);
  // Remove any leftover config
  await fs.remove(CONFIG_PATH).catch(() => {});
  // Override config file path
  _deps.configFile = () => CONFIG_PATH;
  // Override ensureDir to use dirname of config file (not treat the file itself as a dir)
  _deps.ensureDir = async (_dir: string) => fs.ensureDir(path.dirname(CONFIG_PATH));
});

afterEach(async () => {
  _deps.configFile = origConfigFile;
  _deps.ensureDir = origEnsureDir;
  await fs.remove(TMP);
});

describe('config round-trip', () => {
  it('setConfig → getConfig preserves values', async () => {
    await setConfig('registry', 'https://example.com/repo.git');

    const config = await getConfig();
    expect(config.registry).toBe('https://example.com/repo.git');
    // Defaults should still be present
    expect(config).toHaveProperty('skillsRepo');
  });

  it('getConfig returns defaults when no config file exists', async () => {
    const config = await getConfig();
    expect(config).toHaveProperty('registry');
    expect(config).toHaveProperty('skillsRepo');
  });

  it('setConfig preserves existing keys when adding new ones', async () => {
    await setConfig('registry', 'first-value');
    await setConfig('newKey', 'second-value');

    const config = await getConfig();
    expect(config.registry).toBe('first-value');
    expect((config as Record<string, unknown>).newKey).toBe('second-value');
  });

  it('setConfig overwrites existing keys', async () => {
    await setConfig('registry', 'old');
    await setConfig('registry', 'new');

    const config = await getConfig();
    expect(config.registry).toBe('new');
  });

  it('config file is valid JSON', async () => {
    await setConfig('testKey', 'testVal');

    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.testKey).toBe('testVal');
  });
});
