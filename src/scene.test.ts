import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { init, add, remove, installScene, list, validate } from './scene.js';

// ── Mocks ──

const mockPathExists = vi.fn();
const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();

vi.mock('fs-extra', () => ({
  default: {
    pathExists: (...args: unknown[]) => mockPathExists(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
}));

const mockReadJson = vi.fn();
const mockWriteJson = vi.fn();
const mockEnsureDir = vi.fn();

vi.mock('./utils.js', () => ({
  readJson: (...args: unknown[]) => mockReadJson(...args),
  writeJson: (...args: unknown[]) => mockWriteJson(...args),
  ensureDir: (...args: unknown[]) => mockEnsureDir(...args),
}));

const mockInstall = vi.fn();

vi.mock('./package.js', () => ({
  install: (...args: unknown[]) => mockInstall(...args),
}));

const mockFetch = vi.fn();

vi.mock('./registry.js', () => ({
  fetch_: (...args: unknown[]) => mockFetch(...args),
}));

// ── Helpers ──

const SCENE_FILE = 'claw.scene.json';

function captureLog(fn: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(' '));
  const result = fn().finally(() => { console.log = orig; });
  return result.then(() => lines);
}

function captureLogAndError(fn: () => Promise<unknown>): Promise<{ log: string[]; err: string[] }> {
  const logLines: string[] = [];
  const errLines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => logLines.push(args.join(' '));
  console.error = (...args: unknown[]) => errLines.push(args.join(' '));
  const result = fn().finally(() => {
    console.log = origLog;
    console.error = origErr;
  });
  return result.then(() => ({ log: logLines, err: errLines }));
}

const baseScene = {
  name: 'test-scene',
  description: 'A test scene',
  agents: [] as string[],
  skills: [] as string[],
  env: {} as Record<string, string>,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteJson.mockResolvedValue(undefined);
  mockEnsureDir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
});

// ── init ──

describe('init', () => {
  it('creates scene file with correct structure', async () => {
    mockPathExists.mockResolvedValue(false);

    const lines = await captureLog(() => init('my-scene', 'my desc', '/project'));

    expect(mockWriteJson).toHaveBeenCalledWith(
      path.join('/project', SCENE_FILE),
      {
        name: 'my-scene',
        description: 'my desc',
        agents: [],
        skills: [],
        env: {},
      },
    );
    expect(lines.some(l => l.includes('my-scene'))).toBe(true);
  });

  it('creates scene with empty description when not provided', async () => {
    mockPathExists.mockResolvedValue(false);

    await init('my-scene', undefined, '/project');

    expect(mockWriteJson).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ description: '' }),
    );
  });

  it('throws if scene file already exists', async () => {
    mockPathExists.mockResolvedValue(true);

    await expect(init('dup', undefined, '/project')).rejects.toThrow(
      'Scene file already exists',
    );
    expect(mockWriteJson).not.toHaveBeenCalled();
  });

  it('uses cwd when dir is not provided', async () => {
    mockPathExists.mockResolvedValue(false);
    const originalCwd = process.cwd();

    await init('my-scene', 'desc');

    expect(mockWriteJson).toHaveBeenCalledWith(
      path.join(originalCwd, SCENE_FILE),
      expect.anything(),
    );
  });
});

// ── add ──

describe('add', () => {
  it('adds to agents array when fetch_ returns agent type', async () => {
    mockReadJson.mockResolvedValue({ ...baseScene });
    mockFetch.mockResolvedValue({ type: 'agent', name: 'my-agent' });

    await add('my-agent', '/project');

    const savedScene = mockWriteJson.mock.calls[0][1];
    expect(savedScene.agents).toContain('my-agent');
  });

  it('adds to skills array when fetch_ returns skill type', async () => {
    mockReadJson.mockResolvedValue({ ...baseScene });
    mockFetch.mockResolvedValue({ type: 'skill', name: 'cool-skill' });

    await add('cool-skill', '/project');

    const savedScene = mockWriteJson.mock.calls[0][1];
    expect(savedScene.skills).toContain('cool-skill');
  });

  it('skips duplicate agent and prints message', async () => {
    const scene = { ...baseScene, agents: ['my-agent'] };
    mockReadJson.mockResolvedValue(scene);
    mockFetch.mockResolvedValue({ type: 'agent', name: 'my-agent' });

    const lines = await captureLog(() => add('my-agent', '/project'));

    expect(lines.some(l => l.includes('already in scene'))).toBe(true);
    expect(mockWriteJson).not.toHaveBeenCalled();
  });

  it('skips duplicate skill and prints message', async () => {
    const scene = { ...baseScene, skills: ['cool-skill'] };
    mockReadJson.mockResolvedValue(scene);
    mockFetch.mockResolvedValue({ type: 'skill', name: 'cool-skill' });

    const lines = await captureLog(() => add('cool-skill', '/project'));

    expect(lines.some(l => l.includes('already in scene'))).toBe(true);
    expect(mockWriteJson).not.toHaveBeenCalled();
  });

  it('removes from skills when adding as agent', async () => {
    const scene = { ...baseScene, skills: ['my-agent'], agents: [] };
    mockReadJson.mockResolvedValue(scene);
    mockFetch.mockResolvedValue({ type: 'agent', name: 'my-agent' });

    await add('my-agent', '/project');

    const savedScene = mockWriteJson.mock.calls[0][1];
    expect(savedScene.agents).toContain('my-agent');
    expect(savedScene.skills).not.toContain('my-agent');
  });

  it('removes from agents when adding as skill', async () => {
    const scene = { ...baseScene, agents: ['my-skill'], skills: [] };
    mockReadJson.mockResolvedValue(scene);
    mockFetch.mockResolvedValue({ type: 'skill', name: 'my-skill' });

    await add('my-skill', '/project');

    const savedScene = mockWriteJson.mock.calls[0][1];
    expect(savedScene.skills).toContain('my-skill');
    expect(savedScene.agents).not.toContain('my-skill');
  });

  it('defaults to skill type when fetch_ returns null/undefined type', async () => {
    mockReadJson.mockResolvedValue({ ...baseScene });
    mockFetch.mockResolvedValue(null);

    await add('unknown-pkg', '/project');

    const savedScene = mockWriteJson.mock.calls[0][1];
    expect(savedScene.skills).toContain('unknown-pkg');
  });
});

// ── remove ──

describe('remove', () => {
  it('removes from agents array', async () => {
    const scene = { ...baseScene, agents: ['agent-a', 'agent-b'], skills: [] };
    mockReadJson.mockResolvedValue(scene);

    const lines = await captureLog(() => remove('agent-a', '/project'));

    const savedScene = mockWriteJson.mock.calls[0][1];
    expect(savedScene.agents).toEqual(['agent-b']);
    expect(savedScene.agents).not.toContain('agent-a');
    expect(lines.some(l => l.includes('Removed'))).toBe(true);
  });

  it('removes from skills array', async () => {
    const scene = { ...baseScene, skills: ['skill-x'], agents: [] };
    mockReadJson.mockResolvedValue(scene);

    const lines = await captureLog(() => remove('skill-x', '/project'));

    const savedScene = mockWriteJson.mock.calls[0][1];
    expect(savedScene.skills).toEqual([]);
    expect(lines.some(l => l.includes('Removed'))).toBe(true);
  });

  it('no-op when package not found in scene', async () => {
    mockReadJson.mockResolvedValue({ ...baseScene });

    const lines = await captureLog(() => remove('nonexistent', '/project'));

    expect(mockWriteJson).not.toHaveBeenCalled();
    expect(lines.some(l => l.includes('not found'))).toBe(true);
  });
});

// ── installScene ──

describe('installScene', () => {
  it('calls install for each agent and skill', async () => {
    const scene = {
      ...baseScene,
      agents: ['agent-a'],
      skills: ['skill-x'],
    };
    mockReadJson.mockResolvedValue(scene);
    mockInstall.mockResolvedValue({ name: 'pkg', version: '1.0.0' });

    const output = await captureLogAndError(() => installScene('/project'));

    // install called once for agent, once for skill
    expect(mockInstall).toHaveBeenCalledTimes(2);
    expect(mockInstall).toHaveBeenCalledWith('agent-a', '/project', 'agent');
    expect(mockInstall).toHaveBeenCalledWith('skill-x', '/project');

    expect(output.log.some(l => l.includes('Agent: pkg@1.0.0'))).toBe(true);
    expect(output.log.some(l => l.includes('Skill: pkg@1.0.0'))).toBe(true);
  });

  it('continues on individual install failures', async () => {
    const scene = {
      ...baseScene,
      agents: ['bad-agent', 'good-agent'],
      skills: [],
    };
    mockReadJson.mockResolvedValue(scene);
    mockInstall
      .mockRejectedValueOnce(new Error('agent fail'))
      .mockResolvedValueOnce({ name: 'good-agent', version: '2.0.0' });

    const output = await captureLogAndError(() => installScene('/project'));

    expect(output.err.some(l => l.includes('agent fail'))).toBe(true);
    expect(output.log.some(l => l.includes('good-agent@2.0.0'))).toBe(true);
  });

  it('merges scene.env into .env file', async () => {
    const scene = {
      ...baseScene,
      agents: [],
      skills: [],
      env: { API_KEY: '123', HOST: 'localhost' },
    };
    mockReadJson.mockResolvedValue(scene);
    mockPathExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue('EXISTING_VAR=old_value\nAPI_KEY=old_key');

    const output = await captureLogAndError(() => installScene('/project'));

    // Should merge: scene.env overrides existing
    expect(mockWriteFile).toHaveBeenCalledWith(
      path.join('/project', '.env'),
      expect.stringContaining('API_KEY=123'),
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      path.join('/project', '.env'),
      expect.stringContaining('HOST=localhost'),
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      path.join('/project', '.env'),
      expect.stringContaining('EXISTING_VAR=old_value'),
    );
    expect(output.log.some(l => l.includes('variable(s) merged'))).toBe(true);
  });

  it('creates .env file if it does not exist', async () => {
    const scene = {
      ...baseScene,
      agents: [],
      skills: [],
      env: { NEW_VAR: 'value' },
    };
    mockReadJson.mockResolvedValue(scene);
    mockPathExists.mockResolvedValue(false);

    await installScene('/project');

    expect(mockWriteFile).toHaveBeenCalledWith(
      path.join('/project', '.env'),
      expect.stringContaining('NEW_VAR=value'),
    );
  });

  it('does not write .env when scene.env is empty', async () => {
    const scene = { ...baseScene, agents: [], skills: [], env: {} };
    mockReadJson.mockResolvedValue(scene);

    await installScene('/project');

    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

// ── list ──

describe('list', () => {
  it('outputs scene info to console', async () => {
    const scene = {
      name: 'demo-scene',
      description: 'Demo',
      agents: ['agent-1'],
      skills: ['skill-a', 'skill-b'],
      env: { KEY: 'val' },
    };
    mockReadJson.mockResolvedValue(scene);

    const lines = await captureLog(() => list('/project'));

    expect(lines.some(l => l.includes('demo-scene'))).toBe(true);
    expect(lines.some(l => l.includes('Demo'))).toBe(true);
    expect(lines.some(l => l.includes('agent-1'))).toBe(true);
    expect(lines.some(l => l.includes('skill-a'))).toBe(true);
    expect(lines.some(l => l.includes('skill-b'))).toBe(true);
    expect(lines.some(l => l.includes('KEY=val'))).toBe(true);
  });

  it('shows (none) when agents and skills are empty', async () => {
    const scene = { ...baseScene, agents: [], skills: [] };
    mockReadJson.mockResolvedValue(scene);

    const lines = await captureLog(() => list('/project'));

    const noneCount = lines.filter(l => l.includes('(none)')).length;
    expect(noneCount).toBe(2); // one for agents, one for skills
  });
});

// ── validate ──

describe('validate', () => {
  it('returns true for valid scene', async () => {
    mockPathExists.mockResolvedValue(true);
    mockReadJson.mockResolvedValue({
      name: 'valid-scene',
      agents: [],
      skills: [],
      env: {},
    });

    const lines = await captureLog(() => validate('/project'));
    const result = await validate('/project');

    expect(result).toBe(true);
    expect(lines.some(l => l.includes('valid'))).toBe(true);
  });

  it('returns false when scene file does not exist', async () => {
    mockPathExists.mockResolvedValue(false);

    const lines = await captureLog(() => validate('/project'));
    const result = await validate('/project');

    expect(result).toBe(false);
    expect(lines.some(l => l.includes('No scene file found'))).toBe(true);
  });

  it('returns false when name is missing', async () => {
    mockPathExists.mockResolvedValue(true);
    mockReadJson.mockResolvedValue({ agents: [], skills: [] });

    const lines = await captureLog(() => validate('/project'));
    const result = await validate('/project');

    expect(result).toBe(false);
    expect(lines.some(l => l.includes('missing'))).toBe(true);
  });

  it('returns false when agents is not an array', async () => {
    mockPathExists.mockResolvedValue(true);
    mockReadJson.mockResolvedValue({
      name: 'bad-scene',
      agents: 'not-an-array',
      skills: [],
    });

    const lines = await captureLog(() => validate('/project'));
    const result = await validate('/project');

    expect(result).toBe(false);
    expect(lines.some(l => l.includes('agents must be an array'))).toBe(true);
  });

  it('returns false when skills is not an array', async () => {
    mockPathExists.mockResolvedValue(true);
    mockReadJson.mockResolvedValue({
      name: 'bad-scene',
      agents: [],
      skills: 42,
    });

    const lines = await captureLog(() => validate('/project'));
    const result = await validate('/project');

    expect(result).toBe(false);
    expect(lines.some(l => l.includes('skills must be an array'))).toBe(true);
  });

  it('returns false when env is not an object', async () => {
    mockPathExists.mockResolvedValue(true);
    mockReadJson.mockResolvedValue({
      name: 'bad-scene',
      agents: [],
      skills: [],
      env: 'not-an-object',
    });

    const lines = await captureLog(() => validate('/project'));
    const result = await validate('/project');

    expect(result).toBe(false);
    expect(lines.some(l => l.includes('env must be an object'))).toBe(true);
  });

  it('returns false when readJson returns null', async () => {
    mockPathExists.mockResolvedValue(true);
    mockReadJson.mockResolvedValue(null);

    const result = await validate('/project');

    expect(result).toBe(false);
  });
});
