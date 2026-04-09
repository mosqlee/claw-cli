import { describe, it, expect } from 'vitest';
import {
  parsePkgRef, isPathVar, suggestDefault, detectEnvVars, readJson, writeJson, fileHash, dirHash,
  scanSensitiveInfo, replaceSensitiveInfo, detectLang, shouldExclude, isSensitiveFilename, copyDir, pkgDir, installedDir,
} from './utils.js';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

describe('parsePkgRef', () => {
  it('parses name only', () => {
    expect(parsePkgRef('my-skill')).toEqual(['my-skill', 'latest']);
  });

  it('parses name@version', () => {
    expect(parsePkgRef('my-skill@1.2.3')).toEqual(['my-skill', '1.2.3']);
  });

  it('handles scoped npm-like names without version', () => {
    expect(parsePkgRef('@scope/pkg')).toEqual(['@scope/pkg', 'latest']);
  });

  it('handles @prefix@version', () => {
    expect(parsePkgRef('pkg@2.0.0')).toEqual(['pkg', '2.0.0']);
  });
});

describe('isPathVar', () => {
  it('detects URL vars', () => expect(isPathVar('API_URL')).toBe(true));
  it('detects HOST vars', () => expect(isPathVar('DB_HOST')).toBe(true));
  it('detects PATH vars', () => expect(isPathVar('DATA_PATH')).toBe(true));
  it('rejects normal vars', () => expect(isPathVar('API_KEY')).toBe(false));
});

describe('suggestDefault', () => {
  it('suggests URL default', () => expect(suggestDefault('PROXY_URL')).toBe('http://localhost:7890'));
  it('suggests HOST default', () => expect(suggestDefault('HOST')).toBe('localhost'));
  it('suggests PORT default', () => expect(suggestDefault('PORT')).toBe('8080'));
  it('returns empty for unknown', () => expect(suggestDefault('API_KEY')).toBe(''));
});

describe('detectEnvVars', () => {
  it('detects export vars', () => {
    expect(detectEnvVars('export DATABASE_URL=http://localhost')).toContain('DATABASE_URL');
  });

  it('detects os.environ vars', () => {
    expect(detectEnvVars('os.environ["REDIS_HOST"]')).toContain('REDIS_HOST');
  });

  it('detects Chinese env annotations', () => {
    expect(detectEnvVars('环境变量：OPENAI_KEY')).toContain('OPENAI_KEY');
  });

  it('filters short vars', () => {
    expect(detectEnvVars('export X=1')).not.toContain('X');
  });
});

describe('readJson / writeJson', () => {
  const tmpDir = path.join(os.tmpdir(), 'claw-test-' + Date.now());

  it('writes and reads JSON', async () => {
    const fp = path.join(tmpDir, 'test.json');
    await writeJson(fp, { hello: 'world' });
    const data = await readJson<{ hello: string }>(fp);
    expect(data).toEqual({ hello: 'world' });
  });

  it('returns null for missing file', async () => {
    const data = await readJson('/nonexistent/file.json');
    expect(data).toBeNull();
  });
});

describe('fileHash', () => {
  it('returns consistent hash', async () => {
    const tmpDir = path.join(os.tmpdir(), 'claw-hash-' + Date.now());
    const fp = path.join(tmpDir, 'test.txt');
    await fs.ensureDir(tmpDir);
    await fs.writeFile(fp, 'hello');
    const h1 = await fileHash(fp);
    const h2 = await fileHash(fp);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // sha256 hex
  });
});

describe('dirHash', () => {
  it('excludes files in EXCLUDE_FILES', async () => {
    const tmpDir = path.join(os.tmpdir(), 'claw-dirhash-' + Date.now());
    await fs.ensureDir(tmpDir);
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'aaa');
    await fs.writeFile(path.join(tmpDir, '.env'), 'secret');
    await fs.writeFile(path.join(tmpDir, '.env.local'), 'local');

    const h1 = await dirHash(tmpDir);
    // Modify excluded file - hash should not change
    await fs.writeFile(path.join(tmpDir, '.env'), 'changed');
    const h2 = await dirHash(tmpDir);
    expect(h1).toBe(h2);
  });
});

// ── scanSensitiveInfo ──

describe('scanSensitiveInfo', () => {
  it('detects OpenAI API keys', () => {
    const hits = scanSensitiveInfo('OPENAI_API_KEY = "sk-abcdef1234567890abcdef1234567890"');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].type).toBe('secret');
    expect(hits[0].varName).toBe('OPENAI_API_KEY');
    expect(hits[0].raw).toContain('sk-');
  });

  it('detects GitHub tokens', () => {
    const hits = scanSensitiveInfo('GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij');
    expect(hits).toHaveLength(1);
    expect(hits[0].varName).toBe('GITHUB_TOKEN');
  });

  it('detects passwords', () => {
    const hits = scanSensitiveInfo('PASSWORD = "mysecretpassword123"');
    expect(hits).toHaveLength(1);
    expect(hits[0].varName).toBe('PASSWORD');
  });

  it('detects hardcoded home paths', () => {
    const hits = scanSensitiveInfo('cd /Users/johnsmith/projects/app');
    expect(hits).toHaveLength(1);
    expect(hits[0].type).toBe('path');
    expect(hits[0].varName).toBe('HOME_DIR');
  });

  it('ignores generic usernames in paths', () => {
    const hits = scanSensitiveInfo('cd /home/root/config');
    expect(hits).toHaveLength(0);
  });

  it('ignores admin/daemon/shared/nobody/user', () => {
    expect(scanSensitiveInfo('/Users/admin/')).toHaveLength(0);
    expect(scanSensitiveInfo('/home/shared/')).toHaveLength(0);
    expect(scanSensitiveInfo('/home/nobody/')).toHaveLength(0);
  });

  it('deduplicates same varName', () => {
    // OPENAI_API_KEY matches the specific pattern; dedup is by type:varName
    const hits = scanSensitiveInfo('OPENAI_API_KEY="sk-aaa111111111111111111111111"');
    // Both OPENAI_API_KEY and API_KEY patterns match, so we get 2 entries with different varNames
    const openaiHits = hits.filter(h => h.varName === 'OPENAI_API_KEY');
    expect(openaiHits).toHaveLength(1);
  });

  it('returns empty for clean content', () => {
    expect(scanSensitiveInfo('const x = 42;')).toHaveLength(0);
  });
});

// ── replaceSensitiveInfo ──

describe('replaceSensitiveInfo', () => {
  it('replaces secrets in js', () => {
    const input = 'OPENAI_API_KEY = "sk-abcdef1234567890abcdef1234567890"';
    const result = replaceSensitiveInfo(input, 'js');
    expect(result).toContain('process.env.OPENAI_API_KEY');
    expect(result).not.toContain('sk-');
  });

  it('replaces secrets in python', () => {
    const input = 'OPENAI_API_KEY = "sk-abcdef1234567890abcdef1234567890"';
    const result = replaceSensitiveInfo(input, 'py');
    expect(result).toContain('os.environ.get');
  });

  it('replaces secrets in shell', () => {
    const input = 'OPENAI_API_KEY = "sk-abcdef1234567890abcdef1234567890"';
    const result = replaceSensitiveInfo(input, 'sh');
    expect(result).toContain('${OPENAI_API_KEY}');
  });

  it('replaces secrets in markdown', () => {
    const input = 'OPENAI_API_KEY = "sk-abcdef1234567890abcdef1234567890"';
    const result = replaceSensitiveInfo(input, 'md');
    expect(result).toContain('${OPENAI_API_KEY}');
  });

  it('returns clean content unchanged', () => {
    const input = 'const x = 42;';
    expect(replaceSensitiveInfo(input, 'js')).toBe(input);
  });
});

// ── detectLang ──

describe('detectLang', () => {
  it('detects python', () => expect(detectLang('app.py')).toBe('py'));
  it('detects shell', () => expect(detectLang('run.sh')).toBe('sh'));
  it('detects bash', () => expect(detectLang('setup.bash')).toBe('sh'));
  it('detects zsh', () => expect(detectLang('config.zsh')).toBe('sh'));
  it('detects markdown', () => expect(detectLang('README.md')).toBe('md'));
  it('detects txt as md', () => expect(detectLang('notes.txt')).toBe('md'));
  it('defaults to js', () => {
    expect(detectLang('app.js')).toBe('js');
    expect(detectLang('app.ts')).toBe('js');
    expect(detectLang('Makefile')).toBe('js');
  });
});

// ── shouldExclude ──

describe('shouldExclude', () => {
  it('excludes .env files', () => expect(shouldExclude('.env')).toBe(true));
  it('excludes .env.production', () => expect(shouldExclude('.env.production')).toBe(true));
  it('excludes .key files via isSensitiveFilename', () => expect(shouldExclude('server.key')).toBe(true));
  it('keeps .env.example', () => expect(shouldExclude('.env.example')).toBe(false));
  it('keeps normal files', () => expect(shouldExclude('package.json')).toBe(false));
  it('excludes user.md', () => expect(shouldExclude('user.md')).toBe(true));
});

// ── isSensitiveFilename ──

describe('isSensitiveFilename', () => {
  it('detects .pem files', () => expect(isSensitiveFilename('cert.pem')).toBe(true));
  it('detects .key files', () => expect(isSensitiveFilename('id_rsa.key')).toBe(true));
  it('detects .jks files', () => expect(isSensitiveFilename('keystore.jks')).toBe(true));
  it('detects .env in EXCLUDE_FILES', () => expect(isSensitiveFilename('.env')).toBe(true));
  it('passes normal files', () => expect(isSensitiveFilename('index.js')).toBe(false));
  it('case insensitive', () => expect(isSensitiveFilename('CERT.PEM')).toBe(true));
});

// ── copyDir ──

describe('copyDir', () => {
  it('copies directory contents', async () => {
    const srcDir = path.join(os.tmpdir(), 'claw-copy-src-' + Date.now());
    const destDir = path.join(os.tmpdir(), 'claw-copy-dest-' + Date.now());
    await fs.ensureDir(srcDir);
    await fs.writeFile(path.join(srcDir, 'a.txt'), 'aaa');
    await fs.ensureDir(path.join(srcDir, 'sub'));
    await fs.writeFile(path.join(srcDir, 'sub', 'b.txt'), 'bbb');

    await copyDir(srcDir, destDir);

    expect(await fs.pathExists(path.join(destDir, 'a.txt'))).toBe(true);
    expect(await fs.pathExists(path.join(destDir, 'sub', 'b.txt'))).toBe(true);
    expect(await fs.readFile(path.join(destDir, 'a.txt'), 'utf-8')).toBe('aaa');
  });
});

// ── pkgDir / installedDir ──

describe('pkgDir / installedDir', () => {
  it('pkgDir joins registry/skills/name for skill scope', () => {
    const result = pkgDir('skill', 'my-skill');
    expect(result).toContain('registry');
    expect(result).toContain('skills');
    expect(result).toContain('my-skill');
  });

  it('pkgDir joins registry/agents/name for agent scope', () => {
    const result = pkgDir('agent', 'my-agent');
    expect(result).toContain('registry');
    expect(result).toContain('agents');
    expect(result).toContain('my-agent');
  });

  it('installedDir joins packages/scope__name', () => {
    const result = installedDir('agent', 'my-agent');
    expect(result).toContain('packages');
    expect(result).toContain('agent__my-agent');
  });
});
