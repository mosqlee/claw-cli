// Configuration management

import fs from 'fs-extra';
import path from 'path';
import { CONFIG_FILE, DEFAULT_CONFIG, ensureDir } from './utils.js';

export type Config = typeof DEFAULT_CONFIG;

export const _deps = {
  readJson: (p: string) => fs.readJson(p),
  writeJson: (p: string, data: unknown, opts?: object) => fs.writeJson(p, data, opts),
  ensureDir: (dir: string) => ensureDir(dir),
  configFile: () => CONFIG_FILE,
  defaultConfig: () => ({ ...DEFAULT_CONFIG }),
};

export async function getConfig(): Promise<Config> {
  try {
    const data = await _deps.readJson(_deps.configFile());
    return { ..._deps.defaultConfig(), ...data };
  } catch {
    return { ..._deps.defaultConfig() };
  }
}

export async function setConfig(key: string, value: string): Promise<void> {
  const config = await getConfig();
  (config as Record<string, unknown>)[key] = value;
  const configFile = _deps.configFile();
  // Ensure parent directory exists, not the config file itself
  await _deps.ensureDir(path.dirname(configFile));
  await _deps.writeJson(configFile, config, { spaces: 2 });
}

export async function showConfig(): Promise<void> {
  const config = await getConfig();
  for (const [k, v] of Object.entries(config)) {
    console.log(`  ${k}: ${v}`);
  }
}
