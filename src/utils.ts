// Utility functions

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export const REGISTRY_DIR = path.join(os.homedir(), '.claw_store', 'registry');
export const PACKAGES_DIR = path.join(os.homedir(), '.claw_store', 'packages');
export const CONFIG_FILE = path.join(os.homedir(), '.claw_store', 'config.json');
export const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
export const OPENCLAW_CONFIG = path.join(OPENCLAW_DIR, 'openclaw.json');
export const OPENCLAW_AGENTS_DIR = path.join(OPENCLAW_DIR, 'agents');
export const OPENCLAW_SKILLS_DIR = path.join(OPENCLAW_DIR, 'workspace', 'skills');
export const DEFAULT_CONFIG = {
  registry: 'git@github.com:mosqlee/claw-registry.git',
  skillsRepo: 'https://github.com/mosqlee/claw-registry.git',
  agentsRepo: 'https://github.com/mosqlee/claw-registry.git',
  scenesRepo: 'https://github.com/mosqlee/claw-registry.git',
};
// Files always excluded from publish/pack and hash computation
export const EXCLUDE_FILES = new Set([
  'user.md', 'agents.md',
  '.env', '.env.local', '.env.production', '.env.staging', '.env.development', '.env.test',
  'overlay', '.git',
]);

// Filename globs considered sensitive (matched by extension)
export const SENSITIVE_EXTENSIONS = new Set(['.key', '.pem', '.p12', '.pfx', '.jks', '.cert', '.crt']);

export function isSensitiveFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (EXCLUDE_FILES.has(lower)) return true;
  const ext = path.extname(lower);
  return SENSITIVE_EXTENSIONS.has(ext);
}

export interface SensitiveMatch {
  type: 'secret' | 'path';
  varName: string;
  raw: string;
}

/** Detect hardcoded secrets and absolute paths in file content. */
export function scanSensitiveInfo(content: string): SensitiveMatch[] {
  const matches: SensitiveMatch[] = [];
  const seen = new Set<string>();

  const add = (m: SensitiveMatch) => {
    const key = `${m.type}:${m.varName}`;
    if (!seen.has(key)) {
      seen.add(key);
      matches.push(m);
    }
  };

  // --- Secret patterns ---
  const secretPatterns: Array<{ re: RegExp; prefix: string }> = [
    // OpenAI keys  sk-...
    { re: /(?:OPENAI[_-]?API[_-]?KEY|OPENAI[_-]?KEY)\s*[=:]\s*["']?(sk-[A-Za-z0-9_-]{20,})["']?/gi, prefix: 'OPENAI_API_KEY' },
    // GitHub tokens  ghp_ / gho_ / ghu_
    { re: /(?:GITHUB[_-]?TOKEN|GH[_-]?TOKEN|GH[_-]?PAT)\s*[=:]\s*["']?(gh[pou]_[A-Za-z0-9]{30,})["']?/gi, prefix: 'GITHUB_TOKEN' },
    // Google API keys  AIza...
    { re: /(?:GOOGLE[_-]?API[_-]?KEY|GCP[_-]?API[_-]?KEY)\s*[=:]\s*["']?(AIza[A-Za-z0-9_-]{30,})["']?/gi, prefix: 'GOOGLE_API_KEY' },
    // Generic API key patterns
    { re: /(?:API[_-]?KEY|APIKEY)\s*[=:]\s*["']([A-Za-z0-9_-]{20,})["']/gi, prefix: 'API_KEY' },
    // Bearer tokens
    { re: /Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/gi, prefix: 'BEARER_TOKEN' },
    // password=xxx
    { re: /(?:PASSWORD|PASSWD|PASS)\s*[=:]\s*["']([^\s"']{8,})["']/gi, prefix: 'PASSWORD' },
    // Generic secret/token assignment
    { re: /(?:SECRET[_-]?KEY|SECRET|TOKEN)\s*[=:]\s*["']([A-Za-z0-9_-]{20,})["']/gi, prefix: 'SECRET_KEY' },
    // Anthropic keys  sk-ant-...
    { re: /(?:ANTHROPIC[_-]?API[_-]?KEY|ANTHROPIC[_-]?KEY)\s*[=:]\s*["']?(sk-ant-[A-Za-z0-9_-]{20,})["']?/gi, prefix: 'ANTHROPIC_API_KEY' },
  ];

  for (const { re, prefix } of secretPatterns) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) {
      add({ type: 'secret', varName: prefix, raw: m[1] });
    }
  }

  // --- Hardcoded absolute paths with usernames ---
  // /Users/username/, /home/username/, ~username/
  const pathPatterns = [
    { re: /\/Users\/([a-zA-Z0-9_-]+)\//g, name: (m: RegExpExecArray) => `HOME_DIR` },
    { re: /\/home\/([a-zA-Z0-9_-]+)\//g, name: (m: RegExpExecArray) => `HOME_DIR` },
  ];

  for (const { re, name } of pathPatterns) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) {
      const varName = name(m);
      // Only flag if the username is not a generic placeholder
      const username = m[1];
      if (!['shared', 'nobody', 'admin', 'user', 'root', 'daemon'].includes(username.toLowerCase())) {
        add({ type: 'path', varName, raw: m[0].slice(0, -1) }); // raw without trailing /
      }
    }
  }

  return matches;
}

/** Replace hardcoded sensitive values in content with env var references. */
export function replaceSensitiveInfo(content: string, lang: 'js' | 'py' | 'sh' | 'md' = 'js'): string {
  const hits = scanSensitiveInfo(content);
  let result = content;

  for (const hit of hits) {
    switch (lang) {
      case 'py':
        result = result.split(hit.raw).join(`os.environ.get("${hit.varName}", "${hit.raw.slice(0, 4)}...")`);
        break;
      case 'sh':
        result = result.split(hit.raw).join(`\${${hit.varName}}`);
        break;
      case 'md':
        result = result.split(hit.raw).join(`\${${hit.varName}}`);
        break;
      default: // js
        result = result.split(hit.raw).join(`process.env.${hit.varName}`);
        break;
    }
  }
  return result;
}

/** Detect file language from extension for replacement mode. */
export function detectLang(filePath: string): 'js' | 'py' | 'sh' | 'md' {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.py') return 'py';
  if (ext === '.sh' || ext === '.bash' || ext === '.zsh') return 'sh';
  if (ext === '.md' || ext === '.txt') return 'md';
  return 'js';
}

/** Check whether a filename should be excluded during publish/pack copy. */
export function shouldExclude(filename: string): boolean {
  return isSensitiveFilename(filename) || (filename !== '.env.example' && filename.startsWith('.env'));
}

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