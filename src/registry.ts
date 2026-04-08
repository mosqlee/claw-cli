// Registry management - publish, fetch, search

import fs from 'fs-extra';
import path from 'path';
import { PackageMeta, SearchResult } from './types.js';
import { REGISTRY_DIR, pkgDir, ensureDir, readJson, writeJson, copyDir, detectEnvVars } from './utils.js';

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
  
  // Copy package.json
  await fs.copy(pkgPath, path.join(dest, 'package.json'));
  
  // Copy SKILL.md or SOUL.md
  for (const extra of ['SKILL.md', 'SOUL.md', 'TOOLS.template.md', 'AGENTS.md', 'TOOLS.md']) {
    const src = path.join(sourceDir, extra);
    if (await fs.pathExists(src)) {
      await fs.copy(src, path.join(dest, extra));
    }
  }
  
  // Copy scripts directory
  const scriptsDir = path.join(sourceDir, 'scripts');
  if (await fs.pathExists(scriptsDir)) {
    await fs.copy(scriptsDir, path.join(dest, 'scripts'));
  }
  
  // Auto-detect env vars and generate .env.example
  const envVars: string[] = [];
  for (const file of await fs.readdir(sourceDir)) {
    const filePath = path.join(sourceDir, file);
    if ((await fs.stat(filePath)).isFile()) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        envVars.push(...detectEnvVars(content));
      } catch {}
    }
  }
  
  const uniqueVars = [...new Set(envVars)];
  if (uniqueVars.length > 0) {
    const envExample = ['# Environment variables\n', ...uniqueVars.map(v => `${v}=`)].join('\n');
    const envPath = path.join(dest, '.env.example');
    if (!(await fs.pathExists(envPath))) {
      await fs.writeFile(envPath, envExample + '\n');
    }
    // Also write to source dir
    const srcEnvPath = path.join(sourceDir, '.env.example');
    if (!(await fs.pathExists(srcEnvPath))) {
      await fs.writeFile(srcEnvPath, envExample + '\n');
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