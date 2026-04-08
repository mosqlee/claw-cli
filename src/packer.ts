// Offline pack/unpack support

import fs from 'fs-extra';
import path from 'path';
import * as tar from 'tar';
import { PackageMeta } from './types.js';
import { installedDir, pkgDir, ensureDir, readJson, writeJson } from './utils.js';
import { listInstalled } from './package.js';

export async function pack(name: string, outputDir: string): Promise<string> {
  const pkgs = await listInstalled();
  const pkg = pkgs.find(p => p.name === name);
  if (!pkg) {
    throw new Error(`Package '${name}' not installed`);
  }
  
  await ensureDir(outputDir);
  
  const tarballName = `${name}-${pkg.version}.tar.gz`;
  const tarballPath = path.join(outputDir, tarballName);
  
  // Create temp dir with package structure
  const tmpDir = path.join(outputDir, '.tmp-pack');
  await fs.ensureDir(tmpDir);
  
  try {
    // Copy package files
    const srcDir = installedDir(pkg.scope, name);
    const destDir = path.join(tmpDir, 'packages', name);
    await fs.copy(srcDir, destDir);
    
    // Create manifest
    const manifest = {
      manifestVersion: 1,
      packName: name,
      packVersion: pkg.version,
      packages: [{
        name,
        version: pkg.version,
        scope: pkg.scope,
      }],
    };
    await writeJson(path.join(tmpDir, 'manifest.json'), manifest);
    
    // Create tarball
    await tar.create({
      gzip: true,
      file: tarballPath,
      cwd: tmpDir,
    }, ['.']);
    
  } finally {
    await fs.remove(tmpDir);
  }
  
  return tarballPath;
}

export async function installPack(tarballPath: string): Promise<void> {
  const tmpDir = path.join(path.dirname(tarballPath), '.tmp-unpack');
  await fs.ensureDir(tmpDir);
  
  try {
    // Extract tarball
    await tar.extract({
      file: tarballPath,
      cwd: tmpDir,
    });
    
    // Read manifest
    const manifest = await readJson<{
      version: number;
      name: string;
      packages: Array<{ name: string; version: string; scope: string }>;
    }>(path.join(tmpDir, 'manifest.json'));
    
    if (!manifest) {
      throw new Error('Invalid pack: missing manifest.json');
    }
    
    // Copy each package
    for (const pkg of manifest.packages) {
      const srcDir = path.join(tmpDir, 'packages', pkg.name);
      const destDir = installedDir(pkg.scope as 'skill' | 'agent', pkg.name);
      await fs.copy(srcDir, destDir, { overwrite: true });
    }
    
  } finally {
    await fs.remove(tmpDir);
  }
}