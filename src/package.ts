// Package install/uninstall/verify

import fs from 'fs-extra';
import path from 'path';
import readline from 'readline';
import { PackageMeta, InstalledPackage, VerifyResult } from './types.js';
import { pkgDir, installedDir, ensureDir, copyDir, readJson, writeJson, isPathVar, suggestDefault, parsePkgRef } from './utils.js';
import { fetch_ } from './registry.js';

export async function install(pkgRef: string, projectDir?: string, scope?: 'skill' | 'agent'): Promise<PackageMeta | null> {
  const [name, version] = parsePkgRef(pkgRef);
  const meta = await fetch_(name, version);
  if (!meta) {
    return null;  // Not found in local registry, caller should try sync
  }
  
  const actualScope = scope || meta.type || 'skill';
  const dest = installedDir(actualScope, name);
  const regDir = pkgDir(actualScope, name);
  
  await ensureDir(dest);
  
  // Copy from registry
  if (await fs.pathExists(regDir)) {
    for (const entry of await fs.readdir(regDir)) {
      const src = path.join(regDir, entry);
      const dst = path.join(dest, entry);
      if ((await fs.stat(src)).isDirectory()) {
        await fs.copy(src, dst, { overwrite: true });
      } else {
        await fs.copy(src, dst, { overwrite: true });
      }
    }
  }
  
  // Interactive env setup
  await checkEnvSetup(dest, name);
  
  return meta;
}



async function checkEnvSetup(installedDir: string, pkgName: string): Promise<void> {
  const envExample = path.join(installedDir, '.env.example');
  if (!(await fs.pathExists(envExample))) return;
  
  const content = await fs.readFile(envExample, 'utf-8');
  const vars: string[] = [];
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!trimmed.includes('=')) continue;
    const key = trimmed.split('=')[0].trim();
    if (key) vars.push(key);
  }
  
  if (vars.length === 0) return;
  
  // Load existing .env
  const envPath = path.join(installedDir, '.env');
  const existing: Record<string, string> = {};
  if (await fs.pathExists(envPath)) {
    for (const line of (await fs.readFile(envPath, 'utf-8')).split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...valParts] = trimmed.split('=');
      if (key) existing[key.trim()] = valParts.join('=').trim();
    }
  }
  
  // Filter new vars
  const newVars = vars.filter(v => !(v in existing));
  if (newVars.length === 0) return;
  
  console.log(`\n🔧 Setting up environment for ${pkgName}`);
  console.log(`   (${newVars.length} variable(s) to configure)\n`);
  
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  for (const varName of newVars) {
    const isPath = isPathVar(varName);
    const defaultVal = isPath ? suggestDefault(varName) : '';
    const prompt = isPath 
      ? `  📍 ${varName} [${defaultVal}]: `
      : `  🔑 ${varName}: `;
    
    const answer = await new Promise<string>(resolve => {
      rl.question(prompt, resolve);
    });
    
    existing[varName] = answer.trim() || defaultVal;
  }
  
  rl.close();
  
  // Write .env
  const envContent = [`# Env for ${pkgName}`, ...Object.entries(existing).map(([k, v]) => `${k}=${v}`)].join('\n');
  await fs.writeFile(envPath, envContent + '\n');
  console.log(`  ✅ Saved to ${envPath}\n`);
}

export async function uninstall(name: string): Promise<void> {
  for (const scope of ['skill', 'agent'] as const) {
    const dir = installedDir(scope, name);
    if (await fs.pathExists(dir)) {
      await fs.remove(dir);
      return;
    }
  }
}

export async function listInstalled(): Promise<InstalledPackage[]> {
  const pkgs: InstalledPackage[] = [];
  
  const baseDir = path.dirname(installedDir('skill', ''));
  if (!(await fs.pathExists(baseDir))) return pkgs;
  
  for (const entry of await fs.readdir(baseDir)) {
    if (!entry.includes('__')) continue;
    const [scope, name] = entry.split('__') as ['skill' | 'agent', string];
    const pkgPath = path.join(baseDir, entry, 'package.json');
    const data = await readJson<Record<string, unknown>>(pkgPath);
    if (data) {
      pkgs.push({
        name: data.name as string,
        version: (data.version as string) || '1.0.0',
        scope,
        description: data.description as string,
      });
    }
  }
  
  return pkgs;
}

export async function verify(): Promise<VerifyResult[]> {
  const results: VerifyResult[] = [];
  const pkgs = await listInstalled();
  
  for (const pkg of pkgs) {
    const dir = installedDir(pkg.scope, pkg.name);
    if (!(await fs.pathExists(dir))) {
      results.push({ name: pkg.name, scope: pkg.scope, ok: false, actual: '(missing)' });
      continue;
    }
    
    const hasPkgJson = await fs.pathExists(path.join(dir, 'package.json'));
    const hasMd = await fs.pathExists(path.join(dir, 'SKILL.md')) || 
                  await fs.pathExists(path.join(dir, 'SOUL.md'));
    
    results.push({
      name: pkg.name,
      scope: pkg.scope,
      ok: hasPkgJson && hasMd,
      actual: (hasPkgJson && hasMd) ? 'ok' : 'incomplete',
    });
  }
  
  return results;
}

// Agent-specific functions
export async function agentInstall(name: string, projectDir?: string): Promise<PackageMeta | null> {
  return install(name, projectDir, 'agent');
}

export async function agentSoul(name: string): Promise<string> {
  const dir = installedDir('agent', name);
  const soulPath = path.join(dir, 'SOUL.md');
  if (await fs.pathExists(soulPath)) {
    return await fs.readFile(soulPath, 'utf-8');
  }
  throw new Error(`Agent '${name}' has no SOUL.md`);
}