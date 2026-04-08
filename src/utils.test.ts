import { describe, it, expect } from 'vitest';
import { parsePkgRef, isPathVar, suggestDefault, detectEnvVars, readJson, writeJson, fileHash, dirHash } from './utils.js';
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
