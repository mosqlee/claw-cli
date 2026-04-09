import { describe, it, expect, beforeEach } from 'vitest';
import { _deps, publish, fetch_, search, listRegistry, searchRemote, syncRegistry } from './registry.js';
import path from 'path';
import type { Dirent } from 'fs-extra';

// ── Helpers ──

const origDeps = { ..._deps };

beforeEach(() => {
  Object.assign(_deps, origDeps);
});

/** Create a fake Dirent for testing */
function fakeDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as unknown as Dirent;
}

// ── publish ──

describe('publish', () => {
  it('throws when no valid package.json exists', async () => {
    _deps.readJson = async () => null;
    await expect(publish('/fake/source')).rejects.toThrow('No valid package.json');
  });

  it('throws when package.json has no name', async () => {
    _deps.readJson = async () => ({ version: '1.0.0' });
    await expect(publish('/fake/source')).rejects.toThrow('No valid package.json');
  });

  it('publishes with scope from package.json type field', async () => {
    const pkgData = { name: 'my-skill', version: '2.0.0', type: 'skill', description: 'A skill' };
    let readJsonCalls = 0;
    _deps.readJson = async () => {
      readJsonCalls++;
      // First call reads package.json
      if (readJsonCalls === 1) return pkgData;
      return null;
    };
    _deps.pkgDir = (scope: string, name: string) => `/fake/registry/${scope === 'skill' ? 'skills' : 'agents'}/${name}`;
    const ensuredDirs: string[] = [];
    _deps.ensureDir_ = async (dir: string) => { ensuredDirs.push(dir); };
    _deps.ensureDir = async () => {};
    _deps.pathExists = async () => false;
    _deps.copy = async () => {};
    _deps.readdir = async () => [];
    _deps.detectEnvVars = () => [];
    _deps.scanSensitiveInfo = () => [];

    const result = await publish('/fake/source');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('my-skill');
    expect(result!.version).toBe('2.0.0');
    expect(result!.type).toBe('skill');
    expect(ensuredDirs).toContain('/fake/registry/skills/my-skill');
  });

  it('defaults scope to "skill" when no type field and no scope arg', async () => {
    const pkgData = { name: 'my-skill', version: '1.0.0' };
    _deps.readJson = async () => pkgData;
    let capturedScope = '';
    _deps.pkgDir = (scope: string, name: string) => { capturedScope = scope; return `/fake/registry/${scope === 'skill' ? 'skills' : 'agents'}/${name}`; };
    _deps.ensureDir_ = async () => {};
    _deps.ensureDir = async () => {};
    _deps.pathExists = async () => false;
    _deps.copy = async () => {};
    _deps.readdir = async () => [];
    _deps.detectEnvVars = () => [];
    _deps.scanSensitiveInfo = () => [];

    const result = await publish('/fake/source');
    expect(capturedScope).toBe('skill');
    expect(result!.type).toBe('skill');
  });

  it('uses explicit scope argument when type field is absent', async () => {
    const pkgData = { name: 'my-agent', version: '1.0.0' };
    _deps.readJson = async () => pkgData;
    let capturedScope = '';
    _deps.pkgDir = (scope: string, name: string) => { capturedScope = scope; return `/fake/registry/${scope === 'skill' ? 'skills' : 'agents'}/${name}`; };
    _deps.ensureDir_ = async () => {};
    _deps.ensureDir = async () => {};
    _deps.pathExists = async () => false;
    _deps.copy = async () => {};
    _deps.readdir = async () => [];
    _deps.detectEnvVars = () => [];
    _deps.scanSensitiveInfo = () => [];

    const result = await publish('/fake/source', 'agent');
    expect(capturedScope).toBe('agent');
    expect(result!.type).toBe('agent');
  });

  it('copies SKILL.md and SOUL.md when they exist', async () => {
    const pkgData = { name: 'my-skill', version: '1.0.0' };
    let readJsonCalls = 0;
    _deps.readJson = async () => {
      readJsonCalls++;
      if (readJsonCalls === 1) return pkgData;
      return null;
    };
    _deps.pkgDir = (scope: string, name: string) => `/fake/registry/${scope === 'skill' ? 'skills' : 'agents'}/${name}`;
    _deps.ensureDir_ = async () => {};
    _deps.ensureDir = async () => {};
    const existingPaths = new Set([
      '/fake/source/SKILL.md',
      '/fake/source/SOUL.md',
    ]);
    _deps.pathExists = async (p: string) => existingPaths.has(p);
    _deps.copy = async () => {};
    const readFileCalls: string[] = [];
    _deps.readFile = async (p: string) => { readFileCalls.push(p); return ''; };
    _deps.writeFile = async () => {};
    _deps.detectLang = () => 'md' as const;
    _deps.replaceSensitiveInfo = (content: string) => content;
    _deps.readdir = async () => [];
    _deps.detectEnvVars = () => [];
    _deps.scanSensitiveInfo = () => [];

    await publish('/fake/source');
    expect(readFileCalls).toContain('/fake/source/SKILL.md');
    expect(readFileCalls).toContain('/fake/source/SOUL.md');
  });

  it('skips excluded files in scripts directory', async () => {
    const pkgData = { name: 'my-skill', version: '1.0.0' };
    let readJsonCalls = 0;
    _deps.readJson = async () => {
      readJsonCalls++;
      if (readJsonCalls === 1) return pkgData;
      return null;
    };
    _deps.pkgDir = (scope: string, name: string) => `/fake/registry/${scope === 'skill' ? 'skills' : 'agents'}/${name}`;
    _deps.ensureDir_ = async () => {};
    _deps.ensureDir = async () => {};
    _deps.pathExists = async (p: string) => p === '/fake/source/scripts';
    _deps.copy = async () => {};

    const scriptEntries = [
      fakeDirent('run.sh', false),
      fakeDirent('.env', false),
      fakeDirent('server.key', false),
    ];
    let readdirCalls = 0;
    _deps.readdir = async (_p: string, _opts?: object) => {
      readdirCalls++;
      if (readdirCalls === 1) return scriptEntries;
      // scanDir calls for env var detection on sourceDir
      return [];
    };
    _deps.shouldExclude = (name: string) => name === '.env' || name === 'server.key';
    _deps.detectLang = () => 'sh' as const;
    _deps.readFile = async () => 'echo hello';
    _deps.writeFile = async () => {};
    _deps.replaceSensitiveInfo = (content: string) => content;
    _deps.detectEnvVars = () => [];
    _deps.scanSensitiveInfo = () => [];

    await publish('/fake/source');
    // run.sh should be read, but .env and server.key should be excluded
  });

  it('generates .env.example when env vars are detected', async () => {
    const pkgData = { name: 'my-skill', version: '1.0.0' };
    let readJsonCalls = 0;
    _deps.readJson = async () => {
      readJsonCalls++;
      if (readJsonCalls === 1) return pkgData;
      return null;
    };
    _deps.pkgDir = (scope: string, name: string) => `/fake/registry/${scope === 'skill' ? 'skills' : 'agents'}/${name}`;
    _deps.ensureDir_ = async () => {};
    _deps.ensureDir = async () => {};
    _deps.pathExists = async () => false;
    _deps.copy = async () => {};
    _deps.readFile = async () => 'export DATABASE_URL=http://localhost';
    const writtenFiles: Record<string, string> = {};
    _deps.writeFile = async (p: string, c: string) => { writtenFiles[p] = c; };
    _deps.readdir = async () => [fakeDirent('index.js', false)];
    _deps.detectEnvVars = () => ['DATABASE_URL'];
    _deps.scanSensitiveInfo = () => [];

    await publish('/fake/source');
    // Should write .env.example to the dest directory
    const envPath = path.join('/fake/registry/skills/my-skill', '.env.example');
    expect(writtenFiles[envPath]).toBeDefined();
    expect(writtenFiles[envPath]).toContain('DATABASE_URL=');
  });

  it('generates .env.example with secret vars from scanSensitiveInfo', async () => {
    const pkgData = { name: 'my-skill', version: '1.0.0' };
    let readJsonCalls = 0;
    _deps.readJson = async () => {
      readJsonCalls++;
      if (readJsonCalls === 1) return pkgData;
      return null;
    };
    _deps.pkgDir = (scope: string, name: string) => `/fake/registry/${scope === 'skill' ? 'skills' : 'agents'}/${name}`;
    _deps.ensureDir_ = async () => {};
    _deps.ensureDir = async () => {};
    _deps.pathExists = async () => false;
    _deps.copy = async () => {};
    _deps.readFile = async () => 'OPENAI_API_KEY = "sk-abcdef1234567890abcdef1234567890"';
    const writtenFiles: Record<string, string> = {};
    _deps.writeFile = async (p: string, c: string) => { writtenFiles[p] = c; };
    _deps.readdir = async () => [fakeDirent('app.js', false)];
    _deps.detectEnvVars = () => [];
    _deps.scanSensitiveInfo = () => [{ type: 'secret' as const, varName: 'OPENAI_API_KEY', raw: 'sk-abcdef1234567890abcdef1234567890' }];

    await publish('/fake/source');
    const envPath = path.join('/fake/registry/skills/my-skill', '.env.example');
    expect(writtenFiles[envPath]).toBeDefined();
    expect(writtenFiles[envPath]).toContain('OPENAI_API_KEY=');
  });

  it('writes .env.example to source dir only if not already present', async () => {
    const pkgData = { name: 'my-skill', version: '1.0.0' };
    let readJsonCalls = 0;
    _deps.readJson = async () => {
      readJsonCalls++;
      if (readJsonCalls === 1) return pkgData;
      return null;
    };
    _deps.pkgDir = (scope: string, name: string) => `/fake/registry/${scope === 'skill' ? 'skills' : 'agents'}/${name}`;
    _deps.ensureDir_ = async () => {};
    _deps.ensureDir = async () => {};
    // Source .env.example exists
    const existingPaths = new Set(['/fake/source/.env.example']);
    _deps.pathExists = async (p: string) => existingPaths.has(p);
    _deps.copy = async () => {};
    _deps.readFile = async (p: string) => {
      if (p === '/fake/source/.env.example') return 'EXISTING_VAR=hello\n';
      return 'export NEW_VAR=value';
    };
    const writtenFiles: Record<string, string> = {};
    _deps.writeFile = async (p: string, c: string) => { writtenFiles[p] = c; };
    _deps.readdir = async () => [fakeDirent('index.js', false)];
    _deps.detectEnvVars = () => ['NEW_VAR'];
    _deps.scanSensitiveInfo = () => [];

    await publish('/fake/source');
    // Should write to dest but NOT to source dir (already exists)
    const destEnvPath = path.join('/fake/registry/skills/my-skill', '.env.example');
    expect(writtenFiles[destEnvPath]).toBeDefined();
    // Should merge existing and new vars
    expect(writtenFiles[destEnvPath]).toContain('EXISTING_VAR=');
    expect(writtenFiles[destEnvPath]).toContain('NEW_VAR=');
    // Source should NOT be written
    expect(writtenFiles['/fake/source/.env.example']).toBeUndefined();
  });

  it('applies secret replacement on copied files', async () => {
    const pkgData = { name: 'my-skill', version: '1.0.0' };
    let readJsonCalls = 0;
    _deps.readJson = async () => {
      readJsonCalls++;
      if (readJsonCalls === 1) return pkgData;
      return null;
    };
    _deps.pkgDir = (scope: string, name: string) => `/fake/registry/${scope === 'skill' ? 'skills' : 'agents'}/${name}`;
    _deps.ensureDir_ = async () => {};
    _deps.ensureDir = async () => {};
    _deps.pathExists = async (p: string) => p === '/fake/source/SKILL.md';
    _deps.copy = async () => {};
    _deps.readFile = async () => 'OPENAI_API_KEY = "sk-abcdef1234567890abcdef1234567890"';
    const writtenFiles: Record<string, string> = {};
    _deps.writeFile = async (p: string, c: string) => { writtenFiles[p] = c; };
    _deps.detectLang = () => 'js' as const;
    _deps.replaceSensitiveInfo = (content: string) => content.replace(/sk-abcdef1234567890abcdef1234567890/g, 'process.env.OPENAI_API_KEY');
    _deps.readdir = async () => [];
    _deps.detectEnvVars = () => [];
    _deps.scanSensitiveInfo = () => [{ type: 'secret' as const, varName: 'OPENAI_API_KEY', raw: 'sk-abcdef1234567890abcdef1234567890' }];

    await publish('/fake/source');
    const skillPath = path.join('/fake/registry/skills/my-skill', 'SKILL.md');
    expect(writtenFiles[skillPath]).toContain('process.env.OPENAI_API_KEY');
    expect(writtenFiles[skillPath]).not.toContain('sk-abcdef1234567890abcdef1234567890');
  });

  it('returns description and dependencies from package.json', async () => {
    const pkgData = {
      name: 'my-skill',
      version: '3.1.0',
      description: 'A cool skill',
      type: 'skill',
      dependencies: { lodash: '^4.0.0' },
    };
    let readJsonCalls = 0;
    _deps.readJson = async () => {
      readJsonCalls++;
      if (readJsonCalls === 1) return pkgData;
      return null;
    };
    _deps.pkgDir = (scope: string, name: string) => `/fake/registry/${scope === 'skill' ? 'skills' : 'agents'}/${name}`;
    _deps.ensureDir_ = async () => {};
    _deps.ensureDir = async () => {};
    _deps.pathExists = async () => false;
    _deps.copy = async () => {};
    _deps.readdir = async () => [];
    _deps.detectEnvVars = () => [];
    _deps.scanSensitiveInfo = () => [];

    const result = await publish('/fake/source');
    expect(result!.description).toBe('A cool skill');
    expect(result!.dependencies).toEqual({ lodash: '^4.0.0' });
  });
});

// ── fetch_ ──

describe('fetch_', () => {
  it('finds a skill package', async () => {
    const pkgData = { name: 'my-skill', version: '1.0.0', description: 'desc', dependencies: {} };
    let readJsonCalls = 0;
    _deps.readJson = async () => {
      readJsonCalls++;
      if (readJsonCalls === 1) return pkgData; // found in skill scope
      return null;
    };
    _deps.pkgDir = (scope: string, name: string) => `/fake/registry/${scope === 'skill' ? 'skills' : 'agents'}/${name}`;

    const result = await fetch_('my-skill');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('my-skill');
    expect(result!.type).toBe('skill');
  });

  it('falls back to agent scope when not found in skill', async () => {
    const pkgData = { name: 'my-agent', version: '2.0.0', description: 'an agent', dependencies: {} };
    let readJsonCalls = 0;
    _deps.readJson = async () => {
      readJsonCalls++;
      if (readJsonCalls === 1) return null; // not in skill
      return pkgData; // found in agent
    };
    _deps.pkgDir = (scope: string, name: string) => `/fake/registry/${scope === 'skill' ? 'skills' : 'agents'}/${name}`;

    const result = await fetch_('my-agent');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('my-agent');
    expect(result!.type).toBe('agent');
  });

  it('matches exact version', async () => {
    const pkgData = { name: 'my-skill', version: '1.2.3', description: 'desc' };
    let readJsonCalls = 0;
    _deps.readJson = async () => {
      readJsonCalls++;
      return pkgData;
    };
    _deps.pkgDir = (scope: string, name: string) => `/fake/registry/${scope === 'skill' ? 'skills' : 'agents'}/${name}`;

    const result = await fetch_('my-skill', '1.2.3');
    expect(result).not.toBeNull();
    expect(result!.version).toBe('1.2.3');
  });

  it('skips version mismatch and returns null', async () => {
    const pkgData = { name: 'my-skill', version: '1.0.0' };
    _deps.readJson = async () => pkgData;
    _deps.pkgDir = (scope: string, name: string) => `/fake/registry/${scope === 'skill' ? 'skills' : 'agents'}/${name}`;

    const result = await fetch_('my-skill', '2.0.0');
    expect(result).toBeNull();
  });

  it('returns null when package not found in any scope', async () => {
    _deps.readJson = async () => null;
    _deps.pkgDir = (scope: string, name: string) => `/fake/registry/${scope === 'skill' ? 'skills' : 'agents'}/${name}`;

    const result = await fetch_('nonexistent');
    expect(result).toBeNull();
  });

  it('treats version "latest" as no version filter', async () => {
    const pkgData = { name: 'my-skill', version: '5.0.0' };
    _deps.readJson = async () => pkgData;
    _deps.pkgDir = (scope: string, name: string) => `/fake/registry/${scope === 'skill' ? 'skills' : 'agents'}/${name}`;

    const result = await fetch_('my-skill', 'latest');
    expect(result).not.toBeNull();
    expect(result!.version).toBe('5.0.0');
  });

  it('defaults version to 1.0.0 when not in package.json', async () => {
    const pkgData = { name: 'my-skill' };
    _deps.readJson = async () => pkgData;
    _deps.pkgDir = (scope: string, name: string) => `/fake/registry/${scope === 'skill' ? 'skills' : 'agents'}/${name}`;

    const result = await fetch_('my-skill');
    expect(result).not.toBeNull();
    expect(result!.version).toBe('1.0.0');
  });
});

// ── search ──

describe('search', () => {
  it('returns matching packages by name', async () => {
    const scopeDir = '/fake/registry/skills';
    _deps.registryDir = () => '/fake/registry';
    _deps.pathExists = async (p: string) => p === scopeDir;
    _deps.readdir = async () => ['my-skill', 'other-skill', 'unrelated'];
    _deps.readJson = async (p: string) => {
      if (p.includes('my-skill')) return { name: 'my-skill', version: '1.0.0', description: 'desc' };
      if (p.includes('other-skill')) return { name: 'other-skill', version: '2.0.0', description: 'desc' };
      return null;
    };

    const results = await search('my-skill');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('my-skill');
  });

  it('returns all packages when query is empty', async () => {
    _deps.registryDir = () => '/fake/registry';
    _deps.pathExists = async () => true;
    // Return entries for skill and agent scopes
    let readdirCalls = 0;
    _deps.readdir = async () => {
      readdirCalls++;
      if (readdirCalls === 1) return ['skill-a'];
      return ['agent-b'];
    };
    let readJsonCalls = 0;
    _deps.readJson = async () => {
      readJsonCalls++;
      if (readJsonCalls <= 1) return { name: 'skill-a', version: '1.0.0', scope: 'skill', description: 's' };
      return { name: 'agent-b', version: '2.0.0', scope: 'agent', description: 'a' };
    };

    const results = await search('');
    expect(results).toHaveLength(2);
  });

  it('skips dot-prefixed directories', async () => {
    _deps.registryDir = () => '/fake/registry';
    let pathExistsCalls = 0;
    _deps.pathExists = async () => {
      pathExistsCalls++;
      return pathExistsCalls === 1; // only skill scope exists
    };
    _deps.readdir = async () => ['.git', 'my-skill'];
    _deps.readJson = async () => ({ name: 'my-skill', version: '1.0.0', description: 'd' });

    const results = await search('');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('my-skill');
  });

  it('skips scope directories that do not exist', async () => {
    _deps.registryDir = () => '/fake/registry';
    _deps.pathExists = async () => false;
    _deps.readdir = async () => ['my-skill'];

    const results = await search('my-skill');
    expect(results).toHaveLength(0);
  });

  it('performs case-insensitive search', async () => {
    _deps.registryDir = () => '/fake/registry';
    let pathExistsCalls = 0;
    _deps.pathExists = async () => {
      pathExistsCalls++;
      return pathExistsCalls === 1; // only skill scope exists
    };
    _deps.readdir = async () => ['My-Skill'];
    _deps.readJson = async () => ({ name: 'My-Skill', version: '1.0.0', description: 'd' });

    const results = await search('my-skill');
    expect(results).toHaveLength(1);
  });

  it('skips packages with missing or invalid package.json', async () => {
    _deps.registryDir = () => '/fake/registry';
    let pathExistsCalls = 0;
    _deps.pathExists = async () => {
      pathExistsCalls++;
      return pathExistsCalls === 1; // only skill scope exists
    };
    _deps.readdir = async () => ['broken-skill', 'good-skill'];
    let readJsonCalls = 0;
    _deps.readJson = async () => {
      readJsonCalls++;
      if (readJsonCalls === 1) return null; // broken
      return { name: 'good-skill', version: '1.0.0', description: 'good' };
    };

    const results = await search('');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('good-skill');
  });

  it('searches both skill and agent scopes', async () => {
    _deps.registryDir = () => '/fake/registry';
    _deps.pathExists = async () => true;
    let readdirCalls = 0;
    _deps.readdir = async () => {
      readdirCalls++;
      if (readdirCalls === 1) return ['skill-pkg'];
      return ['agent-pkg'];
    };
    let readJsonCalls = 0;
    _deps.readJson = async () => {
      readJsonCalls++;
      if (readJsonCalls === 1) return { name: 'skill-pkg', version: '1.0.0', description: 's' };
      return { name: 'agent-pkg', version: '1.0.0', description: 'a' };
    };

    const results = await search('');
    expect(results).toHaveLength(2);
    const scopes = results.map(r => r.scope);
    expect(scopes).toContain('skill');
    expect(scopes).toContain('agent');
  });
});

// ── listRegistry ──

describe('listRegistry', () => {
  it('delegates to search with empty query', async () => {
    _deps.registryDir = () => '/fake/registry';
    let pathExistsCalls = 0;
    _deps.pathExists = async () => {
      pathExistsCalls++;
      return pathExistsCalls <= 2; // both scopes exist
    };
    let readdirCalls = 0;
    _deps.readdir = async () => {
      readdirCalls++;
      if (readdirCalls === 1) return ['pkg-a'];
      return ['pkg-b'];
    };
    let readJsonCalls = 0;
    _deps.readJson = async () => {
      readJsonCalls++;
      if (readJsonCalls === 1) return { name: 'pkg-a', version: '1.0.0', description: 'd' };
      return { name: 'pkg-b', version: '1.0.0', description: 'd' };
    };

    const results = await listRegistry();
    expect(results).toHaveLength(2);
  });
});

// ── searchRemote ──

describe('searchRemote', () => {
  it('merges local and remote results, marking remote-only items', async () => {
    // Mock config
    _deps.getConfig = async () => ({
      registry: 'https://github.com/test/repo.git',
      skillsRepo: 'https://github.com/test/repo.git',
      agentsRepo: '',
      scenesRepo: '',
    });

    _deps.registryDir = () => '/fake/registry';

    // Track readdir calls by count to distinguish local vs remote
    let readdirCalls = 0;
    _deps.readdir = async (_p: string, opts?: object) => {
      readdirCalls++;
      // Call 1: local skill scope (no withFileTypes)
      if (readdirCalls === 1) return ['local-pkg'] as unknown as Dirent[];
      // Call 2: local agent scope (no withFileTypes)
      if (readdirCalls === 2) return [] as unknown as Dirent[];
      // Call 3: remote skills scope (withFileTypes)
      if (readdirCalls === 3) return [fakeDirent('remote-pkg', true)];
      // Call 4: remote agents scope (withFileTypes)
      if (readdirCalls === 4) return [] as unknown as Dirent[];
      return [] as unknown as Dirent[];
    };

    // Track readJson calls
    let readJsonCalls = 0;
    _deps.readJson = async () => {
      readJsonCalls++;
      // Call 1: local skill/local-pkg/package.json
      if (readJsonCalls === 1) return { name: 'local-pkg', version: '1.0.0', description: 'local' };
      // Call 2: local agent scope - no packages (readdir was empty)
      // Call 3: remote skills/remote-pkg/package.json
      if (readJsonCalls === 2) return { name: 'remote-pkg', version: '2.0.0', description: 'remote' };
      return null;
    };

    // pathExists: true for local skill scope and remote scope dirs
    let pathExistsCalls = 0;
    _deps.pathExists = async () => {
      pathExistsCalls++;
      // First 2 calls are local scope dirs (skill=true, agent=false to keep simple)
      // After that, remote scope dirs
      return pathExistsCalls <= 4;
    };

    _deps.execSync = () => '';
    _deps.ensureDir = async () => {};
    _deps.remove = async () => {};

    const results = await searchRemote('');
    expect(results.length).toBeGreaterThanOrEqual(2);

    // Check remote-only item is marked
    const remotePkg = results.find(r => r.name === 'remote-pkg');
    expect(remotePkg).toBeDefined();
    expect(remotePkg!.source).toBe('remote');
    // Local item should not have source: 'remote'
    const localPkg = results.find(r => r.name === 'local-pkg');
    expect(localPkg).toBeDefined();
    expect(localPkg!.source).toBeUndefined();
  });

  it('returns only local results when remote fails', async () => {
    _deps.registryDir = () => '/fake/registry';
    _deps.pathExists = async (p: string) => !p.includes('tmp');
    _deps.readdir = async () => ['local-pkg'];
    let readJsonCalls = 0;
    _deps.readJson = async () => {
      readJsonCalls++;
      if (readJsonCalls === 1) return { name: 'local-pkg', version: '1.0.0', description: 'local' };
      return null;
    };
    _deps.getConfig = async () => ({
      registry: 'not-a-valid-url',
      skillsRepo: 'not-a-valid-url',
      agentsRepo: '',
      scenesRepo: '',
    });

    const results = await searchRemote('');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('local-pkg');
  });
});

// ── syncRegistry ──

describe('syncRegistry', () => {
  it('calls git clone and sparse-checkout for each subdir', async () => {
    const execCalls: string[] = [];
    _deps.execSync = (cmd: string) => { execCalls.push(cmd); return ''; };
    _deps.getConfig = async () => ({
      registry: 'https://github.com/test/repo.git',
      skillsRepo: '',
      agentsRepo: '',
      scenesRepo: '',
    });
    _deps.ensureDir = async () => {};
    _deps.ensureDir_ = async () => {};
    _deps.pathExists = async () => true;
    _deps.copy = async () => {};
    _deps.remove = async () => {};

    await syncRegistry();

    // Should have clone + sparse-checkout for each of 3 subdirs
    expect(execCalls.length).toBe(6);
    expect(execCalls.some(c => c.includes('git clone'))).toBe(true);
    expect(execCalls.some(c => c.includes('sparse-checkout set skills'))).toBe(true);
    expect(execCalls.some(c => c.includes('sparse-checkout set agents'))).toBe(true);
    expect(execCalls.some(c => c.includes('sparse-checkout set scenes'))).toBe(true);
  });

  it('silently fails on network errors', async () => {
    _deps.execSync = () => { throw new Error('network error'); };
    _deps.getConfig = async () => ({
      registry: 'https://github.com/test/repo.git',
      skillsRepo: '',
      agentsRepo: '',
      scenesRepo: '',
    });
    _deps.ensureDir = async () => {};
    _deps.remove = async () => {};

    // Should not throw
    await expect(syncRegistry()).resolves.toBeUndefined();
  });

  it('cleans up temp directory even on failure', async () => {
    let removed = false;
    let callCount = 0;
    _deps.execSync = () => {
      callCount++;
      throw new Error('fail');
    };
    _deps.getConfig = async () => ({
      registry: 'https://github.com/test/repo.git',
      skillsRepo: '',
      agentsRepo: '',
      scenesRepo: '',
    });
    _deps.ensureDir = async () => {};
    _deps.remove = async () => { removed = true; };

    await syncRegistry();
    expect(removed).toBe(true);
  });

  it('uses skillsRepo as fallback when registry is empty', async () => {
    const execCalls: string[] = [];
    _deps.execSync = (cmd: string) => { execCalls.push(cmd); return ''; };
    _deps.getConfig = async () => ({
      registry: '',
      skillsRepo: 'https://github.com/fallback/repo.git',
      agentsRepo: '',
      scenesRepo: '',
    });
    _deps.ensureDir = async () => {};
    _deps.pathExists = async () => false;
    _deps.remove = async () => {};

    await syncRegistry();
    expect(execCalls.some(c => c.includes('fallback/repo.git'))).toBe(true);
  });
});
