// Registry management - publish, fetch, search

import fs from 'fs-extra';
import path from 'path';
import { PackageMeta, SearchResult } from './types.js';
import {
  REGISTRY_DIR, pkgDir, ensureDir, readJson, writeJson, detectEnvVars,
  isSensitiveFilename, shouldExclude, scanSensitiveInfo, replaceSensitiveInfo, detectLang,
} from './utils.js';

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