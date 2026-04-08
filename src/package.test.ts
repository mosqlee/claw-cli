// Tests for package.ts — install, uninstall, listInstalled, verify, agentInstall, agentSoul

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (vi.mock factories are hoisted above imports) ──

const { mockFs, mockUtils, mockFetch, mockReadline } = vi.hoisted(() => {
  return {
    mockFs: {
      pathExists: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      readdir: vi.fn(),
      stat: vi.fn(),
      copy: vi.fn(),
      remove: vi.fn(),
      ensureDir: vi.fn(),
    },
    mockUtils: {
      pkgDir: vi.fn(),
      installedDir: vi.fn(),
      ensureDir: vi.fn(),
      copyDir: vi.fn(),
      readJson: vi.fn(),
      writeJson: vi.fn(),
      isPathVar: vi.fn(),
      suggestDefault: vi.fn(),
      parsePkgRef: vi.fn(),
    },
    mockFetch: vi.fn(),
    mockReadline: {
      question: vi.fn(),
      close: vi.fn(),
    },
  };
});

vi.mock('fs-extra', () => ({
  default: mockFs,
}));

vi.mock('./utils.js', () => ({
  pkgDir: mockUtils.pkgDir,
  installedDir: mockUtils.installedDir,
  ensureDir: mockUtils.ensureDir,
  copyDir: mockUtils.copyDir,
  readJson: mockUtils.readJson,
  writeJson: mockUtils.writeJson,
  isPathVar: mockUtils.isPathVar,
  suggestDefault: mockUtils.suggestDefault,
  parsePkgRef: mockUtils.parsePkgRef,
  OPENCLAW_DIR: '/home/.openclaw',
  OPENCLAW_CONFIG: '/home/.openclaw/openclaw.json',
  OPENCLAW_AGENTS_DIR: '/home/.openclaw/agents',
  OPENCLAW_SKILLS_DIR: '/home/.openclaw/workspace/skills',
}));

vi.mock('./registry.js', () => ({
  fetch_: mockFetch,
}));

vi.mock('readline', () => ({
  default: {
    createInterface: () => ({
      question: mockReadline.question,
      close: mockReadline.close,
    }),
  },
}));

// ── Import SUT after mocks are set up ──
import { install, uninstall, listInstalled, verify, agentInstall, agentSoul } from './package.js';
import path from 'path';

// ── Helpers ──
beforeEach(() => {
  vi.clearAllMocks();
  // Default: installedDir returns a deterministic path
  mockUtils.installedDir.mockImplementation((scope: string, name: string) =>
    `/home/.claw_store/packages/${scope}__${name}`,
  );
  mockUtils.pkgDir.mockImplementation((scope: string, name: string) =>
    `/home/.claw_store/registry/${scope}/${name}`,
  );
});

// ═══════════════════════════════════════════
// install
// ═══════════════════════════════════════════
describe('install', () => {
  it('performs a normal install: parsePkgRef -> fetch_ -> copy -> checkEnvSetup -> returns meta', async () => {
    mockUtils.parsePkgRef.mockReturnValue(['my-skill', '1.0.0']);
    const meta = { name: 'my-skill', version: '1.0.0', type: 'skill' as const };
    mockFetch.mockResolvedValue(meta);

    // Registry dir exists with files
    mockFs.readdir.mockResolvedValue(['index.js', 'subdir']);
    mockFs.stat.mockImplementation((p: string) => {
      const name = path.basename(p);
      return Promise.resolve({ isDirectory: () => name === 'subdir' });
    });

    // pathExists: 1st = regDir check, 2nd = .env.example check
    mockFs.pathExists
      .mockResolvedValueOnce(true)   // regDir exists
      .mockResolvedValueOnce(false); // .env.example does not exist

    const result = await install('my-skill@1.0.0');

    expect(mockUtils.parsePkgRef).toHaveBeenCalledWith('my-skill@1.0.0');
    expect(mockFetch).toHaveBeenCalledWith('my-skill', '1.0.0');
    expect(mockUtils.ensureDir).toHaveBeenCalledWith('/home/.claw_store/packages/skill__my-skill');
    // Copies each entry from registry to installed + deploy to OpenClaw
    expect(mockFs.copy).toHaveBeenCalled();
    expect(result).toEqual(meta);
  });

  it('returns null when fetch_ returns null (package not found)', async () => {
    mockUtils.parsePkgRef.mockReturnValue(['missing-pkg', 'latest']);
    mockFetch.mockResolvedValue(null);

    const result = await install('missing-pkg');

    expect(result).toBeNull();
    // Should not attempt any file operations beyond fetch
    expect(mockUtils.ensureDir).not.toHaveBeenCalled();
    expect(mockFs.copy).not.toHaveBeenCalled();
  });

  it('uses explicit scope parameter over meta.type', async () => {
    mockUtils.parsePkgRef.mockReturnValue(['my-agent', '2.0.0']);
    const meta = { name: 'my-agent', version: '2.0.0', type: 'skill' as const };
    mockFetch.mockResolvedValue(meta);

    // regDir does not exist, .env.example does not exist, OPENCLAW_CONFIG does not exist
    mockFs.pathExists
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);

    const result = await install('my-agent', undefined, 'agent');

    // Should use 'agent' scope, not 'skill' from meta.type
    expect(mockUtils.installedDir).toHaveBeenCalledWith('agent', 'my-agent');
    expect(mockUtils.pkgDir).toHaveBeenCalledWith('agent', 'my-agent');
    expect(result).toEqual(meta);
  });

  it('skips registry copy when regDir does not exist', async () => {
    mockUtils.parsePkgRef.mockReturnValue(['bare-skill', 'latest']);
    const meta = { name: 'bare-skill', version: '0.1.0' };
    mockFetch.mockResolvedValue(meta);

    mockFs.pathExists
      .mockResolvedValueOnce(false)  // regDir
      .mockResolvedValueOnce(false); // .env.example

    await install('bare-skill');

    expect(mockFs.readdir).not.toHaveBeenCalled();
  });

  it('runs interactive env setup when .env.example exists with new vars', async () => {
    mockUtils.parsePkgRef.mockReturnValue(['env-skill', '1.0.0']);
    const meta = { name: 'env-skill', version: '1.0.0', type: 'skill' as const };
    mockFetch.mockResolvedValue(meta);

    const envExample = 'API_KEY=my-key\n# comment\nDB_HOST=\n';

    mockFs.pathExists
      .mockResolvedValueOnce(false)  // regDir - skip copy
      .mockResolvedValueOnce(true)   // .env.example exists
      .mockResolvedValueOnce(false); // .env does NOT exist yet

    mockFs.readFile.mockResolvedValueOnce(envExample); // only .env.example is read

    mockUtils.isPathVar.mockImplementation((v: string) => v === 'DB_HOST');
    mockUtils.suggestDefault.mockImplementation((v: string) => v === 'DB_HOST' ? 'localhost' : '');

    // Mock readline answers
    mockReadline.question.mockImplementationOnce((_prompt: string, cb: (answer: string) => void) => cb('my-secret-key'));
    mockReadline.question.mockImplementationOnce((_prompt: string, cb: (answer: string) => void) => cb(''));

    await install('env-skill');

    // Should have prompted for 2 new vars (API_KEY, DB_HOST)
    expect(mockReadline.question).toHaveBeenCalledTimes(2);
    expect(mockReadline.close).toHaveBeenCalled();
    // Should write the .env file
    expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
    const writtenContent = mockFs.writeFile.mock.calls[0][1] as string;
    expect(writtenContent).toContain('API_KEY=my-secret-key');
    expect(writtenContent).toContain('DB_HOST=localhost'); // uses default since empty answer
  });
});

// ═══════════════════════════════════════════
// uninstall
// ═══════════════════════════════════════════
describe('uninstall', () => {
  it('removes skill directory when found', async () => {
    mockFs.pathExists
      .mockResolvedValueOnce(true)   // skill dir exists
      .mockResolvedValueOnce(false); // OPENCLAW_SKILLS_DIR/my-skill does not exist

    await uninstall('my-skill');

    expect(mockFs.pathExists).toHaveBeenCalledWith('/home/.claw_store/packages/skill__my-skill');
    expect(mockFs.remove).toHaveBeenCalledWith('/home/.claw_store/packages/skill__my-skill');
    expect(mockFs.pathExists).toHaveBeenCalledTimes(2);
  });

  it('removes agent directory when skill directory not found', async () => {
    mockFs.pathExists
      .mockResolvedValueOnce(false)  // skill dir not found
      .mockResolvedValueOnce(true)   // agent dir found
      .mockResolvedValueOnce(false)  // OPENCLAW_AGENTS_DIR/my-agent does not exist
      .mockResolvedValueOnce(false); // OPENCLAW_CONFIG does not exist

    await uninstall('my-agent');

    expect(mockFs.pathExists).toHaveBeenCalledWith('/home/.claw_store/packages/skill__my-agent');
    expect(mockFs.pathExists).toHaveBeenCalledWith('/home/.claw_store/packages/agent__my-agent');
    expect(mockFs.remove).toHaveBeenCalledWith('/home/.claw_store/packages/agent__my-agent');
  });

  it('is a no-op when neither skill nor agent directory exists', async () => {
    mockFs.pathExists
      .mockResolvedValueOnce(false)  // skill dir not found
      .mockResolvedValueOnce(false); // agent dir not found

    await uninstall('nonexistent');

    expect(mockFs.remove).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════
// listInstalled
// ═══════════════════════════════════════════
describe('listInstalled', () => {
  it('returns array of InstalledPackage from directories with __ separator', async () => {
    mockUtils.installedDir.mockImplementation((scope: string, name: string) =>
      `/home/.claw_store/packages/${scope}__${name}`,
    );

    mockFs.pathExists.mockResolvedValueOnce(true); // baseDir exists
    mockFs.readdir.mockResolvedValueOnce(['skill__my-skill', 'agent__my-agent', 'random-file']);

    mockUtils.readJson.mockImplementation((p: string) => {
      if (p.includes('skill__my-skill')) {
        return Promise.resolve({ name: 'my-skill', version: '1.0.0', description: 'A skill' });
      }
      if (p.includes('agent__my-agent')) {
        return Promise.resolve({ name: 'my-agent', version: '2.0.0', description: 'An agent' });
      }
      return Promise.resolve(null);
    });

    const result = await listInstalled();

    // 'random-file' has no __ so it's skipped
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: 'my-skill',
      version: '1.0.0',
      scope: 'skill',
      description: 'A skill',
    });
    expect(result[1]).toEqual({
      name: 'my-agent',
      version: '2.0.0',
      scope: 'agent',
      description: 'An agent',
    });
  });

  it('returns empty array when packages dir does not exist', async () => {
    mockFs.pathExists.mockResolvedValueOnce(false);

    const result = await listInstalled();

    expect(result).toEqual([]);
    expect(mockFs.readdir).not.toHaveBeenCalled();
  });

  it('skips entries without valid package.json', async () => {
    mockUtils.installedDir.mockImplementation((scope: string, name: string) =>
      `/home/.claw_store/packages/${scope}__${name}`,
    );

    mockFs.pathExists.mockResolvedValueOnce(true); // baseDir exists
    mockFs.readdir.mockResolvedValueOnce(['skill__good', 'skill__bad']);

    mockUtils.readJson.mockImplementation((p: string) => {
      if (p.includes('skill__good')) {
        return Promise.resolve({ name: 'good', version: '1.0.0' });
      }
      return Promise.resolve(null);
    });

    const result = await listInstalled();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('good');
  });
});

// ═══════════════════════════════════════════
// verify
// ═══════════════════════════════════════════
describe('verify', () => {
  it('reports all packages ok when they have package.json + SKILL.md/SOUL.md', async () => {
    mockUtils.installedDir.mockImplementation((scope: string, name: string) =>
      `/home/.claw_store/packages/${scope}__${name}`,
    );

    // listInstalled needs baseDir + readdir + readJson
    mockFs.pathExists.mockResolvedValueOnce(true); // baseDir exists
    mockFs.readdir.mockResolvedValueOnce(['skill__my-skill']);
    mockUtils.readJson.mockResolvedValueOnce({ name: 'my-skill', version: '1.0.0' });

    // verify checks: dir exists, package.json exists, SKILL.md exists
    mockFs.pathExists
      .mockResolvedValueOnce(true)   // installed dir exists
      .mockResolvedValueOnce(true)   // package.json exists
      .mockResolvedValueOnce(true);  // SKILL.md exists

    const results = await verify();

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      name: 'my-skill',
      scope: 'skill',
      ok: true,
      actual: 'ok',
    });
  });

  it('reports package missing SKILL.md as ok: false', async () => {
    mockUtils.installedDir.mockImplementation((scope: string, name: string) =>
      `/home/.claw_store/packages/${scope}__${name}`,
    );

    mockFs.pathExists.mockResolvedValueOnce(true); // baseDir
    mockFs.readdir.mockResolvedValueOnce(['skill__broken']);
    mockUtils.readJson.mockResolvedValueOnce({ name: 'broken', version: '1.0.0' });

    mockFs.pathExists
      .mockResolvedValueOnce(true)    // installed dir exists
      .mockResolvedValueOnce(true)    // package.json exists
      .mockResolvedValueOnce(false)   // SKILL.md does NOT exist
      .mockResolvedValueOnce(false);  // SOUL.md does NOT exist

    const results = await verify();

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      name: 'broken',
      scope: 'skill',
      ok: false,
      actual: 'incomplete',
    });
  });

  it('reports package with missing directory as ok: false with "(missing)"', async () => {
    mockUtils.installedDir.mockImplementation((scope: string, name: string) =>
      `/home/.claw_store/packages/${scope}__${name}`,
    );

    mockFs.pathExists.mockResolvedValueOnce(true); // baseDir
    mockFs.readdir.mockResolvedValueOnce(['skill__ghost']);
    mockUtils.readJson.mockResolvedValueOnce({ name: 'ghost', version: '1.0.0' });

    mockFs.pathExists.mockResolvedValueOnce(false); // installed dir does NOT exist

    const results = await verify();

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      name: 'ghost',
      scope: 'skill',
      ok: false,
      actual: '(missing)',
    });
  });
});

// ═══════════════════════════════════════════
// agentInstall
// ═══════════════════════════════════════════
describe('agentInstall', () => {
  it('delegates to install with scope=agent', async () => {
    mockUtils.parsePkgRef.mockReturnValue(['my-agent', 'latest']);
    const meta = { name: 'my-agent', version: '1.0.0', type: 'agent' as const };
    mockFetch.mockResolvedValue(meta);

    mockFs.pathExists
      .mockResolvedValueOnce(false)  // regDir
      .mockResolvedValueOnce(false)  // .env.example (checkEnvSetup)
      .mockResolvedValueOnce(false); // OPENCLAW_CONFIG (updateOpenClawConfig)

    const result = await agentInstall('my-agent', '/project');

    expect(mockUtils.parsePkgRef).toHaveBeenCalledWith('my-agent');
    // installedDir should have been called with 'agent' scope
    expect(mockUtils.installedDir).toHaveBeenCalledWith('agent', 'my-agent');
    expect(result).toEqual(meta);
  });
});

// ═══════════════════════════════════════════
// agentSoul
// ═══════════════════════════════════════════
describe('agentSoul', () => {
  it('returns SOUL.md content when file exists', async () => {
    mockFs.pathExists.mockResolvedValueOnce(true);
    mockFs.readFile.mockResolvedValueOnce('# My Agent Soul\n\nI am a helpful agent.');

    const result = await agentSoul('my-agent');

    expect(mockFs.pathExists).toHaveBeenCalledWith('/home/.claw_store/packages/agent__my-agent/SOUL.md');
    expect(result).toBe('# My Agent Soul\n\nI am a helpful agent.');
  });

  it('throws when SOUL.md not found', async () => {
    mockFs.pathExists.mockResolvedValueOnce(false);

    await expect(agentSoul('missing-agent')).rejects.toThrow(
      "Agent 'missing-agent' has no SOUL.md",
    );

    expect(mockFs.readFile).not.toHaveBeenCalled();
  });
});
