import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { pack, installPack } from '../src/packer.js';
import { installedDir } from '../src/utils.js';

// These tests use the REAL filesystem. We mock only network (child_process).

const TMP = path.join(os.tmpdir(), 'claw-integ-pack-' + Date.now());

beforeEach(async () => {
  await fs.ensureDir(TMP);
});

afterEach(async () => {
  await fs.remove(TMP);
});

describe('pack → installPack round-trip', () => {
  it('packs an installed package and reinstalls it from tarball', async () => {
    const pkgName = 'test-skill-pack';
    const pkgScope = 'skill';

    // 1. Simulate an "installed" package
    const installDir = installedDir(pkgScope, pkgName);
    await fs.ensureDir(installDir);
    await fs.writeJson(path.join(installDir, 'package.json'), {
      name: pkgName,
      version: '1.0.0',
      type: pkgScope,
      description: 'A test skill for integration',
    });
    await fs.writeFile(path.join(installDir, 'index.js'), 'module.exports = "hello";');
    await fs.writeFile(path.join(installDir, '.env'), 'SECRET=should-be-excluded');
    await fs.ensureDir(path.join(installDir, 'subdir'));
    await fs.writeFile(path.join(installDir, 'subdir', 'helper.js'), '// helper');

    try {
      // 2. Pack it
      const outputDir = path.join(TMP, 'output');
      const tarballPath = await pack(pkgName, outputDir);

      expect(await fs.pathExists(tarballPath)).toBe(true);
      expect(tarballPath).toMatch(/\.tar\.gz$/);

      // 3. Remove the original installed package
      await fs.remove(installDir);
      expect(await fs.pathExists(installDir)).toBe(false);

      // 4. Reinstall from tarball
      await installPack(tarballPath);

      // 5. Verify the package was restored
      expect(await fs.pathExists(installDir)).toBe(true);
      const restoredPkg = await fs.readJson(path.join(installDir, 'package.json'));
      expect(restoredPkg.name).toBe(pkgName);
      expect(restoredPkg.version).toBe('1.0.0');

      // Verify regular file was restored
      const indexContent = await fs.readFile(path.join(installDir, 'index.js'), 'utf-8');
      expect(indexContent).toBe('module.exports = "hello";');

      // Verify subdir was restored
      expect(await fs.pathExists(path.join(installDir, 'subdir', 'helper.js'))).toBe(true);
    } finally {
      // Cleanup installed dir
      await fs.remove(installDir).catch(() => {});
    }
  });

  it('pack throws when package is not installed', async () => {
    await expect(pack('nonexistent-pkg-xyz', TMP)).rejects.toThrow('not installed');
  });

  it('installPack throws for invalid tarball', async () => {
    const badTar = path.join(TMP, 'bad.tar.gz');
    await fs.writeFile(badTar, 'not a tarball');
    await expect(installPack(badTar)).rejects.toThrow();
  });
});
