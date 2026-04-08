import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { pack, installPack } from './packer.js';

// ── Hoisted mocks ──

const { mockFs, mockTar } = vi.hoisted(() => ({
  mockFs: {
    ensureDir: vi.fn(),
    readdir: vi.fn(),
    copy: vi.fn(),
    remove: vi.fn(),
  },
  mockTar: {
    create: vi.fn(),
    extract: vi.fn(),
  },
}));

const mockInstalledDir = vi.fn();
const mockPkgDir = vi.fn();
const mockEnsureDir = vi.fn();
const mockReadJson = vi.fn();
const mockWriteJson = vi.fn();
const mockShouldExclude = vi.fn();
const mockListInstalled = vi.fn();

vi.mock('fs-extra', () => ({ default: mockFs }));
vi.mock('tar', () => mockTar);
vi.mock('./utils.js', () => ({
  installedDir: (...a: unknown[]) => mockInstalledDir(...a),
  pkgDir: (...a: unknown[]) => mockPkgDir(...a),
  ensureDir: (...a: unknown[]) => mockEnsureDir(...a),
  readJson: (...a: unknown[]) => mockReadJson(...a),
  writeJson: (...a: unknown[]) => mockWriteJson(...a),
  shouldExclude: (...a: unknown[]) => mockShouldExclude(...a),
}));
vi.mock('./package.js', () => ({
  listInstalled: (...a: unknown[]) => mockListInstalled(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsureDir.mockResolvedValue(undefined);
  mockShouldExclude.mockReturnValue(false);
  mockWriteJson.mockResolvedValue(undefined);
  mockFs.ensureDir.mockResolvedValue(undefined);
  mockFs.remove.mockResolvedValue(undefined);
  mockFs.copy.mockResolvedValue(undefined);
  mockTar.create.mockResolvedValue(undefined);
  mockTar.extract.mockResolvedValue(undefined);
});

// ── pack ──

describe('pack', () => {
  it('normal flow: copies files, creates manifest, creates tarball', async () => {
    const pkg = { name: 'my-skill', version: '1.2.3', scope: 'skill' as const };
    mockListInstalled.mockResolvedValue([pkg]);
    mockInstalledDir.mockReturnValue('/store/packages/skill__my-skill');
    mockFs.readdir.mockResolvedValue([
      { name: 'index.js', isDirectory: () => false },
      { name: 'package.json', isDirectory: () => false },
    ]);

    const result = await pack('my-skill', '/output');

    expect(result).toBe(path.join('/output', 'my-skill-1.2.3.tar.gz'));
    expect(mockEnsureDir).toHaveBeenCalledWith('/output');
    expect(mockWriteJson).toHaveBeenCalledWith(
      path.join('/output', '.tmp-pack', 'manifest.json'),
      expect.objectContaining({ manifestVersion: 1, packName: 'my-skill' }),
    );
    expect(mockTar.create).toHaveBeenCalled();
    expect(mockFs.remove).toHaveBeenCalledWith(path.join('/output', '.tmp-pack'));
  });

  it('throws error when package is not installed', async () => {
    mockListInstalled.mockResolvedValue([]);
    await expect(pack('missing-pkg', '/output')).rejects.toThrow("Package 'missing-pkg' not installed");
  });

  it('excludes sensitive files', async () => {
    const pkg = { name: 'my-skill', version: '2.0.0', scope: 'skill' as const };
    mockListInstalled.mockResolvedValue([pkg]);
    mockInstalledDir.mockReturnValue('/store/packages/skill__my-skill');
    mockShouldExclude.mockImplementation((name: string) => name === '.env');
    mockFs.readdir.mockResolvedValue([
      { name: 'index.js', isDirectory: () => false },
      { name: '.env', isDirectory: () => false },
    ]);

    await pack('my-skill', '/output');
    // Only index.js copied, .env excluded
    expect(mockFs.copy).toHaveBeenCalledTimes(1);
  });

  it('cleans up tmp dir even on error', async () => {
    const pkg = { name: 'my-skill', version: '1.0.0', scope: 'skill' as const };
    mockListInstalled.mockResolvedValue([pkg]);
    mockInstalledDir.mockReturnValue('/store/packages/skill__my-skill');
    mockFs.readdir.mockRejectedValue(new Error('readdir fail'));

    await expect(pack('my-skill', '/output')).rejects.toThrow('readdir fail');
    expect(mockFs.remove).toHaveBeenCalledWith(path.join('/output', '.tmp-pack'));
  });
});

// ── installPack ──

describe('installPack', () => {
  it('normal flow: extracts, reads manifest, copies packages', async () => {
    const manifest = {
      version: 1, name: 'my-skill',
      packages: [
        { name: 'my-skill', version: '1.0.0', scope: 'skill' },
        { name: 'my-agent', version: '2.0.0', scope: 'agent' },
      ],
    };
    mockReadJson.mockResolvedValue(manifest);
    mockInstalledDir
      .mockReturnValueOnce('/store/packages/skill__my-skill')
      .mockReturnValueOnce('/store/packages/agent__my-agent');

    await installPack('/tarballs/pack.tar.gz');

    const tmpDir = path.join('/tarballs', '.tmp-unpack');
    expect(mockTar.extract).toHaveBeenCalledWith({ file: '/tarballs/pack.tar.gz', cwd: tmpDir });
    expect(mockReadJson).toHaveBeenCalledWith(path.join(tmpDir, 'manifest.json'));
    expect(mockFs.copy).toHaveBeenCalledTimes(2);
    expect(mockFs.remove).toHaveBeenCalledWith(tmpDir);
  });

  it('throws "Invalid pack" when manifest is missing', async () => {
    mockReadJson.mockResolvedValue(null);
    await expect(installPack('/tarballs/pack.tar.gz')).rejects.toThrow('Invalid pack: missing manifest.json');
    expect(mockFs.remove).toHaveBeenCalled();
  });

  it('cleans up tmp dir even when manifest read fails', async () => {
    mockReadJson.mockRejectedValue(new Error('disk error'));
    await expect(installPack('/tarballs/pack.tar.gz')).rejects.toThrow('disk error');
    expect(mockFs.remove).toHaveBeenCalledWith(path.join('/tarballs', '.tmp-unpack'));
  });

  it('reads and applies manifest.packages correctly for single package', async () => {
    const manifest = {
      version: 1, name: 'solo',
      packages: [{ name: 'solo-skill', version: '0.1.0', scope: 'skill' }],
    };
    mockReadJson.mockResolvedValue(manifest);
    mockInstalledDir.mockReturnValue('/store/packages/skill__solo-skill');

    await installPack('/out/solo.tar.gz');
    expect(mockFs.copy).toHaveBeenCalledTimes(1);
  });
});
