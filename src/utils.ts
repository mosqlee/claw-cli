// Utility functions

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export const REGISTRY_DIR = path.join(os.homedir(), '.claw_store', 'registry');
export const PACKAGES_DIR = path.join(os.homedir(), '.claw_store', 'packages');
export const EXCLUDE_FILES = new Set(['user.md', 'agents.md', '.env.local', '.env', 'overlay', '.git']);

export function pkgDir(scope: string, name: string): string {
  return path.join(REGISTRY_DIR, scope, name);
}

export function installedDir(scope: string, name: string): string {
  return path.join(PACKAGES_DIR, `${scope}__${name}`);
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.ensureDir(dir);
}

export async function readJson<T>(filepath: string): Promise<T | null> {
  try {
    return await fs.readJson(filepath);
  } catch {
    return null;
  }
}

export async function writeJson(filepath: string, data: unknown): Promise<void> {
  await fs.ensureDir(path.dirname(filepath));
  await fs.writeJson(filepath, data, { spaces: 2 });
}

export async function fileHash(filepath: string): Promise<string> {
  const content = await fs.readFile(filepath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function dirHash(dirpath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  
  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    
    // Sort for consistent ordering
    const dirs = entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter(e => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));
    
    for (const dir of dirs) {
      if (!EXCLUDE_FILES.has(dir.name.toLowerCase())) {
        await walk(path.join(currentPath, dir.name));
      }
    }
    
    for (const file of files) {
      if (EXCLUDE_FILES.has(file.name.toLowerCase())) continue;
      
      const filePath = path.join(currentPath, file.name);
      const relPath = path.relative(dirpath, filePath);
      hash.update(relPath);
      
      const content = await fs.readFile(filePath);
      hash.update(content);
    }
  }
  
  await walk(dirpath);
  return hash.digest('hex');
}

export async function copyDir(src: string, dest: string): Promise<void> {
  await fs.ensureDir(dest);
  await fs.copy(src, dest, { overwrite: true, errorOnExist: false });
}

export function parsePkgRef(ref: string): [string, string] {
  // Parse 'name[@version]' into [name, version]
  const idx = ref.lastIndexOf('@');
  if (idx > 0 && /\d/.test(ref[idx + 1])) {
    return [ref.slice(0, idx), ref.slice(idx + 1)];
  }
  return [ref, 'latest'];
}

export function isPathVar(varName: string): boolean {
  const keywords = ['URL', 'HOST', 'PORT', 'PATH', 'DIR', 'BASE', 'HOME', 'ROOT'];
  return keywords.some(kw => varName.toUpperCase().includes(kw));
}

export function suggestDefault(varName: string): string {
  const upper = varName.toUpperCase();
  if (upper.includes('PROXY') || upper.includes('URL')) return 'http://localhost:7890';
  if (upper.includes('HOST')) return 'localhost';
  if (upper.includes('PORT')) return '8080';
  if (upper.includes('PATH') || upper.includes('DIR')) return '~/.local/share/claw';
  return '';
}

export function detectEnvVars(content: string): string[] {
  const vars: Set<string> = new Set();
  
  // export VAR=
  const exportMatch = content.matchAll(/export\s+(\w+)/g);
  for (const m of exportMatch) {
    if (m[1].length > 3) vars.add(m[1]);
  }
  
  // os.environ["VAR"] or os.getenv("VAR")
  const environMatch = content.matchAll(/os\.(?:environ|getenv)\s*[\[\(]\s*["'](\w+)["']/g);
  for (const m of environMatch) {
    if (m[1].length > 3) vars.add(m[1]);
  }
  
  // 环境变量：VAR
  const cnMatch = content.matchAll(/(?:环境变量|ENV|env)[\s：:]+(\w+)/gi);
  for (const m of cnMatch) {
    if (m[1].length > 3 && m[1].toUpperCase() === m[1]) vars.add(m[1]);
  }
  
  return Array.from(vars).sort();
}