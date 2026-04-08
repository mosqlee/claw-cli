// Claw CLI self-update

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import semver from 'semver';

type InstallMethod = 'npm' | 'github' | 'unknown';

// ── Injectable side-effects (overridable for testing) ──

export const _deps: {
  getEntryPath: () => string | null;
  realpath: (p: string) => string;
  exists: (p: string) => boolean;
  readFile: (p: string) => string;
  exec: (cmd: string, cwd?: string) => string;
} = {
  getEntryPath: () => process.argv[1] ?? null,
  realpath: (p: string) => fs.realpathSync(p),
  exists: (p: string) => fs.existsSync(p),
  readFile: (p: string) => fs.readFileSync(p, 'utf-8'),
  exec: (cmd: string, cwd?: string): string => {
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  },
};

// ── Internal helpers ──

function getOwnDir(): string {
  const entry = _deps.getEntryPath();
  if (!entry) return process.cwd();
  const real = _deps.realpath(entry);
  return path.dirname(real);
}

function getCurrentVersion(): string {
  const ownDir = getOwnDir();
  const candidates = [
    path.join(ownDir, '..', 'package.json'),
    path.join(ownDir, 'package.json'),
  ];
  for (const p of candidates) {
    try {
      const data = JSON.parse(_deps.readFile(p));
      if (data.version) return data.version;
    } catch { /* try next */ }
  }
  return '0.0.0';
}

function getRepoDir(entry: string): string {
  const real = _deps.realpath(entry);
  let dir = path.dirname(real);
  for (let i = 0; i < 10; i++) {
    if (_deps.exists(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

// ── Exported core functions ──

export function detectInstallMethod(): InstallMethod {
  const entry = _deps.getEntryPath();
  if (!entry) return 'unknown';

  const real = _deps.realpath(entry);

  if (real.includes('node_modules')) return 'npm';

  let dir = path.dirname(real);
  for (let i = 0; i < 10; i++) {
    if (_deps.exists(path.join(dir, '.git'))) return 'github';
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return 'unknown';
}

interface VersionCheck {
  current: string;
  latest: string;
  needsUpdate: boolean;
}

export function checkForUpdate(method: InstallMethod): VersionCheck {
  const current = getCurrentVersion();
  let latest = current;

  if (method === 'npm') {
    latest = _deps.exec('npm view openclaw-claw version');
  } else if (method === 'github') {
    const repoDir = getRepoDir(_deps.getEntryPath()!);
    const tags = _deps.exec('git ls-remote --tags --sort=-v:refname origin', repoDir);
    const firstLine = tags.split('\n')[0] || '';
    const tagMatch = firstLine.match(/refs\/tags\/v?(\d+\.\d+\.\d+)/);
    if (tagMatch) latest = tagMatch[1];
  }

  return { current, latest, needsUpdate: semver.gt(latest, current) };
}

function performUpdate(method: InstallMethod): string {
  if (method === 'npm') {
    _deps.exec('npm update -g openclaw-claw');
  } else if (method === 'github') {
    const repoDir = getRepoDir(_deps.getEntryPath()!);
    _deps.exec('git pull --ff-only', repoDir);
    _deps.exec('npm install', repoDir);
    _deps.exec('npx tsc', repoDir);
  }
  return getCurrentVersion();
}

export async function update(options: { check?: boolean } = {}): Promise<void> {
  const method = detectInstallMethod();
  console.log(`Current version: v${getCurrentVersion()}`);

  if (method === 'unknown') {
    console.log('⚠️  Could not detect installation method.');
    console.log('Manual update:');
    console.log('  npm:  npm update -g openclaw-claw');
    console.log('  git:  cd <repo> && git pull && npm install && npx tsc');
    return;
  }

  console.log(`Install method: ${method}`);

  let check: VersionCheck;
  try {
    check = checkForUpdate(method);
  } catch (err) {
    throw new Error(`Failed to check for updates: ${(err as Error).message}`);
  }

  if (!check.needsUpdate) {
    console.log(`✅ Already up to date (v${check.current})`);
    return;
  }

  console.log(`Update available: v${check.current} → v${check.latest}`);

  if (options.check) {
    console.log('Run `claw update` (without --check) to apply.');
    return;
  }

  console.log('Updating...');
  try {
    const newVersion = performUpdate(method);
    if (semver.eq(newVersion, check.latest)) {
      console.log(`✅ Updated to v${newVersion}`);
    } else {
      console.log(`⚠️  Update applied but version is still v${newVersion} (expected v${check.latest})`);
    }
  } catch (err) {
    throw new Error(`Update failed: ${(err as Error).message}`);
  }
}
