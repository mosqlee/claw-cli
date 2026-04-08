import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { fileHash, dirHash, readJson, writeJson, pkgDir, installedDir, detectEnvVars, scanSensitiveInfo, replaceSensitiveInfo } from '../src/utils.js';

const TMP = path.join(os.tmpdir(), 'claw-integ-utils-' + Date.now());

beforeEach(async () => {
  await fs.ensureDir(TMP);
});

afterEach(async () => {
  await fs.remove(TMP);
});

describe('utils round-trip', () => {
  it('writeJson → readJson preserves data', async () => {
    const fp = path.join(TMP, 'test.json');
    const data = { name: 'test', nested: { a: 1, b: [1, 2, 3] } };
    await writeJson(fp, data);
    const result = await readJson<typeof data>(fp);
    expect(result).toEqual(data);
  });

  it('readJson returns null for missing file', async () => {
    const result = await readJson('/nonexistent/file.json');
    expect(result).toBeNull();
  });

  it('fileHash is consistent', async () => {
    const fp = path.join(TMP, 'hash-test.txt');
    await fs.writeFile(fp, 'consistent content');
    const h1 = await fileHash(fp);
    const h2 = await fileHash(fp);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it('fileHash changes when content changes', async () => {
    const fp = path.join(TMP, 'hash-change.txt');
    await fs.writeFile(fp, 'version 1');
    const h1 = await fileHash(fp);
    await fs.writeFile(fp, 'version 2');
    const h2 = await fileHash(fp);
    expect(h1).not.toBe(h2);
  });

  it('dirHash excludes sensitive files', async () => {
    const dir = path.join(TMP, 'dirhash-test');
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, 'code.js'), 'console.log(1);');
    await fs.writeFile(path.join(dir, '.env'), 'SECRET=value');

    const h1 = await dirHash(dir);
    // Modify .env - hash should not change
    await fs.writeFile(path.join(dir, '.env'), 'SECRET=changed');
    const h2 = await dirHash(dir);
    expect(h1).toBe(h2);

    // Modify code.js - hash should change
    await fs.writeFile(path.join(dir, 'code.js'), 'console.log(2);');
    const h3 = await dirHash(dir);
    expect(h3).not.toBe(h1);
  });

  it('detectEnvVars detects shell-style env vars', () => {
    const code = 'export DATABASE_URL=http://localhost:5432\nexport REDIS_HOST=localhost';
    const vars = detectEnvVars(code);
    expect(vars).toContain('DATABASE_URL');
    expect(vars).toContain('REDIS_HOST');
  });

  it('scanSensitiveInfo → replaceSensitiveInfo works end-to-end', () => {
    const code = 'OPENAI_API_KEY = "sk-abcdef1234567890abcdef1234567890"';
    const hits = scanSensitiveInfo(code);
    expect(hits.length).toBeGreaterThanOrEqual(1);

    const replaced = replaceSensitiveInfo(code, 'js');
    expect(replaced).toContain('process.env.OPENAI_API_KEY');
    expect(replaced).not.toContain('sk-abcdef1234567890abcdef1234567890');
  });

  it('pkgDir and installedDir produce valid paths', () => {
    const pd = pkgDir('skill', 'my-skill');
    expect(pd).toContain('registry');
    expect(pd).toContain('skill');
    expect(pd).toContain('my-skill');

    const id = installedDir('agent', 'my-agent');
    expect(id).toContain('packages');
    expect(id).toContain('agent__my-agent');
  });
});
