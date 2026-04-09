// Registry management - publish, fetch, search

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { PackageMeta, SearchResult } from './types.js';
import {
  REGISTRY_DIR, pkgDir, ensureDir, readJson, writeJson, detectEnvVars,
  isSensitiveFilename, shouldExclude, scanSensitiveInfo, replaceSensitiveInfo, detectLang,
  DEFAULT_CONFIG,
} from './utils.js';
import { getConfig } from './config.js';

// ── Injectable side-effects (overridable for testing) ──

export const _deps: Record<string, any> = { // eslint-disable-line @typescript-eslint/no-explicit-any
  readFile: (p: string) => fs.readFile(p, 'utf-8'),
  writeFile: (p: string, c: string) => fs.writeFile(p, c, 'utf-8'),
  copy: (src: string, dst: string, opts?: object) => fs.copy(src, dst, opts),
  ensureDir: (p: string) => fs.ensureDir(p),
  readdir: (p: string, opts?: object) => fs.readdir(p, opts as object | undefined),
  pathExists: (p: string) => fs.pathExists(p),
  remove: (p: string) => fs.remove(p),
  readJson: <T>(p: string) => readJson<T>(p),
  ensureDir_: (dir: string) => ensureDir(dir),
  pkgDir: (scope: string, name: string) => pkgDir(scope, name),
  registryDir: () => REGISTRY_DIR,
  getConfig: () => getConfig(),
  detectEnvVars: (content: string) => detectEnvVars(content),
  isSensitiveFilename: (name: string) => isSensitiveFilename(name),
  shouldExclude: (name: string) => shouldExclude(name),
  scanSensitiveInfo: (content: string) => scanSensitiveInfo(content),
  replaceSensitiveInfo: (content: string, lang: 'js' | 'py' | 'sh' | 'md') => replaceSensitiveInfo(content, lang),
  detectLang: (fp: string) => detectLang(fp),
  execSync: (cmd: string, opts?: object) => execSync(cmd, opts),
  tmpdir: () => os.tmpdir(),
};

export async function publish(sourceDir: string, scope?: 'skill' | 'agent'): Promise<PackageMeta | null> {
  const pkgPath = path.join(sourceDir, 'package.json');
  const data = await _deps.readJson(pkgPath) as Record<string, unknown> | null;
  if (!data || !data.name) {
    throw new Error(`No valid package.json in ${sourceDir}`);
  }

  const pkgScope = (data.type as 'skill' | 'agent') || scope || 'skill';
  const name = data.name as string;
  const dest = _deps.pkgDir(pkgScope, name);

  await _deps.ensureDir_(dest);

  // Helper: copy a single file to registry, applying secret replacement on the copy
  const copyFileSecure = async (src: string, destFile: string) => {
    const lang = _deps.detectLang(src);
    const content = await _deps.readFile(src);
    // Scan for secrets and replace in the copy only
    const cleaned = _deps.replaceSensitiveInfo(content, lang);
    await _deps.ensureDir(path.dirname(destFile));
    await _deps.writeFile(destFile, cleaned);
  };

  // Helper: copy a directory recursively, excluding sensitive files
  const copyDirSecure = async (src: string, destDir: string) => {
    await _deps.ensureDir(destDir);
    const entries = (await _deps.readdir(src, { withFileTypes: true })) as unknown as fs.Dirent[];
    for (const entry of entries) {
      if (_deps.shouldExclude(entry.name)) continue;
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        await copyDirSecure(srcPath, destPath);
      } else {
        await copyFileSecure(srcPath, destPath);
      }
    }
  };

  // Copy package.json (not excluded)
  await _deps.copy(pkgPath, path.join(dest, 'package.json'));

  // Copy SKILL.md, SOUL.md, AGENTS.md, TOOLS.template.md, TOOLS.md (apply replacement)
  // Check both root directory and workspace/ subdirectory (for agents)
  const coreFiles = ['SKILL.md', 'SOUL.md', 'AGENTS.md', 'TOOLS.template.md', 'TOOLS.md'];
  for (const extra of coreFiles) {
    // Check root directory first
    const srcRoot = path.join(sourceDir, extra);
    if (await _deps.pathExists(srcRoot)) {
      await copyFileSecure(srcRoot, path.join(dest, extra));
    }
    // For agents, also check workspace/ subdirectory
    if (pkgScope === 'agent') {
      const srcWorkspace = path.join(sourceDir, 'workspace', extra);
      if (await _deps.pathExists(srcWorkspace)) {
        await copyFileSecure(srcWorkspace, path.join(dest, 'workspace', extra));
      }
    }
  }

  // Copy scripts directory (exclude sensitive files)
  // Check both root directory and workspace/ subdirectory
  const scriptsDirRoot = path.join(sourceDir, 'scripts');
  if (await _deps.pathExists(scriptsDirRoot)) {
    await copyDirSecure(scriptsDirRoot, path.join(dest, 'scripts'));
  }
  // For agents, also copy workspace/scripts
  if (pkgScope === 'agent') {
    const scriptsDirWorkspace = path.join(sourceDir, 'workspace', 'scripts');
    if (await _deps.pathExists(scriptsDirWorkspace)) {
      await copyDirSecure(scriptsDirWorkspace, path.join(dest, 'workspace', 'scripts'));
    }
  }

  // Scan ALL files for env vars and secrets, generate .env.example
  const envVars: string[] = [];
  const secretVars: string[] = [];
  const scanDir = async (dir: string) => {
    const entries = (await _deps.readdir(dir, { withFileTypes: true })) as unknown as fs.Dirent[];
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      if (_deps.isSensitiveFilename(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else {
        try {
          const content = await _deps.readFile(fullPath);
          envVars.push(..._deps.detectEnvVars(content));
          const hits = _deps.scanSensitiveInfo(content);
          for (const h of hits) secretVars.push(h.varName);
        } catch { /* binary or unreadable — skip */ }
      }
    }
  };
  await scanDir(sourceDir);

  // Merge and deduplicate
  const allVars = [...new Set([...envVars, ...secretVars])].sort();
  if (allVars.length > 0) {
    // Read existing .env.example from source if present, to preserve user comments
    const srcEnvPath = path.join(sourceDir, '.env.example');
    const existingVars = new Set<string>();
    if (await _deps.pathExists(srcEnvPath)) {
      const existing = await _deps.readFile(srcEnvPath);
      for (const line of existing.split('\n')) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
        if (m) existingVars.add(m[1]);
      }
    }

    const merged = [...new Set([...existingVars, ...allVars])].sort();
    const envExample = ['# Environment variables\n', ...merged.map(v => `${v}=`)].join('\n') + '\n';

    // Always write to registry destination
    await _deps.writeFile(path.join(dest, '.env.example'), envExample);

    // Write to source dir only if not already present
    if (!(await _deps.pathExists(srcEnvPath))) {
      await _deps.writeFile(srcEnvPath, envExample);
    }
  }

  return {
    name,
    version: (data.version as string) || '1.0.0',
    description: data.description as string,
    type: pkgScope,
    dependencies: data.dependencies as Record<string, string>,
  };
}

export async function fetch_(name: string, version?: string): Promise<PackageMeta | null> {
  // Search in skill then agent scope
  for (const scope of ['skill', 'agent'] as const) {
    const dir = _deps.pkgDir(scope, name);
    const pkgPath = path.join(dir, 'package.json');
    const data = await _deps.readJson(pkgPath) as Record<string, unknown> | null;
    if (data) {
      const pkgVersion = (data.version as string) || '1.0.0';
      if (version && version !== 'latest' && pkgVersion !== version) continue;
      return {
        name: data.name as string,
        version: pkgVersion,
        description: data.description as string,
        type: scope,
        dependencies: data.dependencies as Record<string, string>,
      };
    }
  }
  return null;
}

export async function search(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  for (const scope of ['skill', 'agent'] as const) {
    const pluralScope = scope === 'skill' ? 'skills' : 'agents';
    const scopeDir = path.join(_deps.registryDir(), pluralScope);
    if (!(await _deps.pathExists(scopeDir))) continue;

    for (const name of (await _deps.readdir(scopeDir)) as unknown as string[]) {
      if (name.startsWith('.')) continue;
      if (query && !name.toLowerCase().includes(queryLower)) continue;

      const pkgPath = path.join(scopeDir, name, 'package.json');
      const data = await _deps.readJson(pkgPath) as Record<string, unknown> | null;
      if (data) {
        results.push({
          name: data.name as string,
          version: (data.version as string) || '1.0.0',
          scope,
          description: data.description as string,
        });
      }
    }
  }

  return results;
}

export async function listRegistry(): Promise<SearchResult[]> {
  return search('');
}

// --- Remote search via GitHub API ---

async function fetchRemotePackages(repoUrl: string, subdir: string, query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  try {
    // Parse GitHub repo URL to API path
    const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!match) return results;

    // Use git sparse checkout to get remote package metadata
    const tmpDir = path.join(_deps.tmpdir(), `claw-remote-${Date.now()}`);

    await _deps.ensureDir(tmpDir);
    try {
      _deps.execSync(`git clone --depth 1 --filter=blob:none --sparse ${repoUrl} ${tmpDir} 2>/dev/null`, { timeout: 30000 });
      _deps.execSync(`cd ${tmpDir} && git sparse-checkout set ${subdir} 2>/dev/null`, { timeout: 15000 });

      // Find all package.json files in the subdir
      const scopeDir = path.join(tmpDir, subdir);
      if (!(await _deps.pathExists(scopeDir))) return results;

      const entries = (await _deps.readdir(scopeDir, { withFileTypes: true })) as unknown as fs.Dirent[];
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        if (query && !entry.name.toLowerCase().includes(queryLower)) continue;

        const pkgPath = path.join(scopeDir, entry.name, 'package.json');
        const data = await _deps.readJson(pkgPath) as Record<string, unknown> | null;
        if (data) {
          const scope = subdir === 'agents' ? 'agent' as const : 'skill' as const;
          results.push({
            name: data.name as string || entry.name,
            version: (data.version as string) || '1.0.0',
            scope,
            description: data.description as string,
            source: 'remote',
          });
        }
      }
    } finally {
      await _deps.remove(tmpDir);
    }
  } catch {
    // Silently fail on network errors
  }

  return results;
}

/** Search both local registry and remote repos. */
export async function searchRemote(query: string): Promise<SearchResult[]> {
  const config = await _deps.getConfig();
  const registryUrl = config.registry || config.skillsRepo;
  const [localResults, ...remoteResults] = await Promise.all([
    search(query),
    fetchRemotePackages(registryUrl, 'skills', query),
    fetchRemotePackages(registryUrl, 'agents', query),
  ]);

  // Merge: remote items not already in local get marked
  const localNames = new Set(localResults.map(r => r.name));
  for (const remote of remoteResults.flat()) {
    if (!localNames.has(remote.name)) {
      (remote as SearchResult & { source?: string }).source = 'remote';
      localResults.push(remote);
    }
  }

  return localResults;
}

/** Pull remote registry to local cache */
export async function syncRegistry(): Promise<void> {
  const config = await _deps.getConfig();
  const registryUrl = config.registry || config.skillsRepo;

  // Remote and local now both use plural directory names
  const subdirs = ['skills', 'agents', 'scenes'];

  for (const subdir of subdirs) {
    const tmpDir = path.join(_deps.tmpdir(), `claw-sync-${Date.now()}`);
    try {
      await _deps.ensureDir(tmpDir);
      _deps.execSync(`git clone --depth 1 --filter=blob:none --sparse ${registryUrl} ${tmpDir}/repo 2>/dev/null`, { timeout: 60000 });
      _deps.execSync(`cd ${tmpDir}/repo && git sparse-checkout set ${subdir} 2>/dev/null`, { timeout: 15000 });

      const src = path.join(tmpDir, 'repo', subdir);
      const dst = path.join(_deps.registryDir(), subdir);
      if (await _deps.pathExists(src)) {
        await _deps.ensureDir_(dst);
        await _deps.copy(src, dst, { overwrite: true });
      }
    } catch {
      // Silently fail - network errors, git not available, etc.
    } finally {
      await _deps.remove(tmpDir);
    }
  }
}