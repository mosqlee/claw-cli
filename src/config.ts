// Configuration management

import fs from 'fs-extra';
import { CONFIG_FILE, DEFAULT_CONFIG, ensureDir } from './utils.js';

export type Config = typeof DEFAULT_CONFIG;

export async function getConfig(): Promise<Config> {
  try {
    const data = await fs.readJson(CONFIG_FILE);
    return { ...DEFAULT_CONFIG, ...data };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function setConfig(key: string, value: string): Promise<void> {
  const config = await getConfig();
  (config as Record<string, unknown>)[key] = value;
  await ensureDir(CONFIG_FILE);
  await fs.writeJson(CONFIG_FILE, config, { spaces: 2 });
}

export async function showConfig(): Promise<void> {
  const config = await getConfig();
  for (const [k, v] of Object.entries(config)) {
    console.log(`  ${k}: ${v}`);
  }
}
