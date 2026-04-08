// Registry management - publish, fetch, search

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { PackageMeta, SearchResult } from './types.js';
import {
  REGISTRY_DIR, pkgDir, ensureDir, readJson, writeJson, detectEnvVars,
  isSensitiveFilename, shouldExclude, scanSensitiveInfo, replaceSensitiveInfo, detectLang,
  DEFAULT_CONFIG,
} from './utils.js';
import { getConfig } from './config.js';

export async function publish(sourceDir: string, scope?: 'skill' | 'agent'): Promise<PackageMeta | null> {
  const pkgPath = path.join(sourceDir, 'package.json');
  const data = await readJson<Record<string, unknown>>(pkgPath);
  if (!data || !data.name) {
    throw new Error(`No valid package.json in ${sourceDir}`);
  }

  const pkgScope = (data.type as 'skill' | 'agent') || scope || 'skill';
  const name = data.name as string;
  const dest = pkgDir(pkgScope, name);

  await ensureDir(dest);

  // Helper: copy a single file to registry, applying secret replacement on the copy
  const copyFileSecure = async (src: string, destFile: string) => {
    const lang = detectLang(src);
    const content = await fs.readFile(src, 'utf-8');
    // Scan for secrets and replace in the copy only
    const cleaned = replaceSensitiveInfo(content, lang);
    await fs.ensureDir(path.dirname(destFile));
    await fs.writeFile(destFile, cleaned, 'utf-8');
  };

  // Helper: copy a directory recursively, excluding sensitive files
  const copyDirSecure = async (src: string, destDir: string) => {
    await fs.ensureDir(destDir);
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldExclude(entry.name)) continue;
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
  await fs.copy(pkgPath, path.join(dest, 'package.json'));

  // Copy SKILL.md, SOUL.md, TOOLS.template.md, TOOLS.md (apply replacement)
  for (const extra of ['SKILL.md', 'SOUL.md', 'TOOLS.template.md', 'TOOLS.md']) {
    const src = path.join(sourceDir, extra);
    if (await fs.pathExists(src)) {
      await copyFileSecure(src, path.join(dest, extra));
    }
  }

  // Copy scripts directory (exclude sensitive files)
  const scriptsDir = path.join(sourceDir, 'scripts');
  if (await fs.pathExists(scriptsDir)) {
    await copyDirSecure(scriptsDir, path.join(dest, 'scripts'));
  }

  // Scan ALL files for env vars and secrets, generate .env.example
  const envVars: string[] = [];
  const secretVars: string[] = [];
  const scanDir = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      if (isSensitiveFilename(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else {
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          envVars.push(...detectEnvVars(content));
          const hits = scanSensitiveInfo(content);
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
    if (await fs.pathExists(srcEnvPath)) {
      const existing = await fs.readFile(srcEnvPath, 'utf-8');
      for (const line of existing.split('\n')) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
        if (m) existingVars.add(m[1]);
      }
    }

    const merged = [...new Set([...existingVars, ...allVars])].sort();
    const envExample = ['# Environment variables\n', ...merged.map(v => `${v}=`)].join('\n') + '\n';

    // Always write to registry destination
    await fs.writeFile(path.join(dest, '.env.example'), envExample, 'utf-8');

    // Write to source dir only if not already present
    if (!(await fs.pathExists(srcEnvPath))) {
      await fs.writeFile(srcEnvPath, envExample, 'utf-8');
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
    const dir = pkgDir(scope, name);
    const pkgPath = path.join(dir, 'package.json');
    const data = await readJson<Record<string, unknown>>(pkgPath);
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
    const scopeDir = path.join(REGISTRY_DIR, scope);
    if (!(await fs.pathExists(scopeDir))) continue;
    
    for (const name of await fs.readdir(scopeDir)) {
      if (name.startsWith('.')) continue;
      if (query && !name.toLowerCase().includes(queryLower)) continue;
      
      const pkgPath = path.join(scopeDir, name, 'package.json');
      const data = await readJson<Record<string, unknown>>(pkgPath);
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

    const [, owner, repo] = match;
    // Try to use gh CLI first (authenticated), fallback to public API
    let treeData: Array<{ path: string; type: string }> = [];

    // Use git sparse checkout to get remote package metadata
    const { execSync } = await import('child_process');
    const tmpDir = path.join(os.tmpdir(), `claw-remote-${Date.now()}`);

    await fs.ensureDir(tmpDir);
    try {
      execSync(`git clone --depth 1 --filter=blob:none --sparse ${repoUrl} ${tmpDir} 2>/dev/null`, { timeout: 30000 });
      execSync(`cd ${tmpDir} && git sparse-checkout set ${subdir} 2>/dev/null`, { timeout: 15000 });

      // Find all package.json files in the subdir
      const scopeDir = path.join(tmpDir, subdir);
      if (!(await fs.pathExists(scopeDir))) return results;

      const entries = await fs.readdir(scopeDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        if (query && !entry.name.toLowerCase().includes(queryLower)) continue;

        const pkgPath = path.join(scopeDir, entry.name, 'package.json');
        const data = await readJson<Record<string, unknown>>(pkgPath);
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
      await fs.remove(tmpDir);
    }
  } catch {
    // Silently fail on network errors
  }

  return results;
}

/** Search both local registry and remote repos. */
export async function searchRemote(query: string): Promise<SearchResult[]> {
  const config = await getConfig();
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
  const { execSync } = await import('child_process');
  const config = await getConfig();
  const registryUrl = config.registry || config.skillsRepo;

  for (const subdir of ['skills', 'agents', 'scenes']) {
    const tmpDir = path.join(os.tmpdir(), `claw-sync-${Date.now()}`);
    try {
      await fs.ensureDir(tmpDir);
      execSync(`git clone --depth 1 --filter=blob:none --sparse ${registryUrl} ${tmpDir}/repo 2>/dev/null`, { timeout: 60000 });
      execSync(`cd ${tmpDir}/repo && git sparse-checkout set ${subdir} 2>/dev/null`, { timeout: 15000 });

      const src = path.join(tmpDir, 'repo', subdir);
      const dst = path.join(REGISTRY_DIR, subdir);
      if (await fs.pathExists(src)) {
        await ensureDir(dst);
        await fs.copy(src, dst, { overwrite: true });
      }
    } catch {
      // Silently fail
    } finally {
      await fs.remove(tmpDir);
    }
  }
}