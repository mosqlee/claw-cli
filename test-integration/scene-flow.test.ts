import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { init, add, remove, installScene, list, validate } from '../src/scene.js';
import { writeJson } from '../src/utils.js';

const TMP = path.join(os.tmpdir(), 'claw-integ-scene-' + Date.now());

beforeEach(async () => {
  await fs.ensureDir(TMP);
});

afterEach(async () => {
  await fs.remove(TMP);
});

const SCENE_FILE = 'claw.scene.json';

describe('scene flow', () => {
  it('init → add → remove → validate round-trip', async () => {
    // 1. Init scene
    const origLog = console.log;
    const logLines: string[] = [];
    console.log = (...args: unknown[]) => logLines.push(args.join(' '));

    await init('my-integ-scene', 'Integration test scene', TMP);

    console.log = origLog;

    const scenePath = path.join(TMP, SCENE_FILE);
    expect(await fs.pathExists(scenePath)).toBe(true);
    const scene = await fs.readJson(scenePath);
    expect(scene.name).toBe('my-integ-scene');
    expect(scene.description).toBe('Integration test scene');

    // 2. Manually add entries (since add() calls fetch_ which needs registry)
    scene.skills = ['skill-a', 'skill-b'];
    scene.agents = ['agent-x'];
    scene.env = { API_KEY: 'test-123' };
    await writeJson(scenePath, scene);

    // 3. Remove one skill
    const logLines2: string[] = [];
    console.log = (...args: unknown[]) => logLines2.push(args.join(' '));
    await remove('skill-b', TMP);
    console.log = console.log; // noop safety

    const updatedScene = await fs.readJson(scenePath);
    expect(updatedScene.skills).toEqual(['skill-a']);
    expect(updatedScene.agents).toEqual(['agent-x']);

    // 4. Validate
    const logLines3: string[] = [];
    console.log = (...args: unknown[]) => logLines3.push(args.join(' '));
    const isValid = await validate(TMP);
    console.log = origLog;
    expect(isValid).toBe(true);

    // 5. List
    const logLines4: string[] = [];
    console.log = (...args: unknown[]) => logLines4.push(args.join(' '));
    await list(TMP);
    console.log = origLog;
    expect(logLines4.some(l => l.includes('my-integ-scene'))).toBe(true);
    expect(logLines4.some(l => l.includes('skill-a'))).toBe(true);
    expect(logLines4.some(l => l.includes('agent-x'))).toBe(true);
  });

  it('init throws when scene file already exists', async () => {
    await init('first', '', TMP);
    await expect(init('second', '', TMP)).rejects.toThrow('already exists');
  });

  it('validate returns false for missing scene file', async () => {
    const logLines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logLines.push(args.join(' '));
    const result = await validate(TMP);
    console.log = origLog;
    expect(result).toBe(false);
  });

  it('validate returns false for scene missing name', async () => {
    await writeJson(path.join(TMP, SCENE_FILE), { agents: [], skills: [] });
    const logLines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logLines.push(args.join(' '));
    const result = await validate(TMP);
    console.log = origLog;
    expect(result).toBe(false);
  });
});
