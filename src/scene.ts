// Scene management - create, edit, install scene configurations

import fs from 'fs-extra';
import path from 'path';
import { SceneConfig } from './types.js';
import { readJson, writeJson, ensureDir } from './utils.js';
import { install } from './package.js';
import { fetch_ } from './registry.js';

const SCENE_FILE = 'claw.scene.json';

export async function init(name: string, description?: string, dir?: string): Promise<void> {
  const targetDir = dir || process.cwd();
  const scenePath = path.join(targetDir, SCENE_FILE);

  if (await fs.pathExists(scenePath)) {
    throw new Error(`Scene file already exists: ${scenePath}`);
  }

  const scene: SceneConfig = {
    name,
    description: description || '',
    agents: [],
    skills: [],
    env: {},
  };

  await writeJson(scenePath, scene);
  console.log(`✅ Scene '${name}' initialized → ${scenePath}`);
}

export async function add(pkg: string, dir?: string): Promise<void> {
  const targetDir = dir || process.cwd();
  const scene = await loadScene(targetDir);

  // Determine type from registry
  const meta = await fetch_(pkg);

  if (meta?.type === 'agent') {
    if (!scene.agents) scene.agents = [];
    if (scene.agents.includes(pkg)) {
      console.log(`⏭️  Agent '${pkg}' already in scene`);
      return;
    }
    scene.agents.push(pkg);
    // Also remove from skills if present
    scene.skills = (scene.skills || []).filter(s => s !== pkg);
  } else {
    if (!scene.skills) scene.skills = [];
    if (scene.skills.includes(pkg)) {
      console.log(`⏭️  Skill '${pkg}' already in scene`);
      return;
    }
    scene.skills.push(pkg);
    scene.agents = (scene.agents || []).filter(a => a !== pkg);
  }

  await saveScene(targetDir, scene);
  const type = meta?.type || 'skill';
  console.log(`✅ Added ${type} '${pkg}' to scene '${scene.name}'`);
}

export async function remove(pkg: string, dir?: string): Promise<void> {
  const targetDir = dir || process.cwd();
  const scene = await loadScene(targetDir);

  const before = (scene.agents?.length || 0) + (scene.skills?.length || 0);
  scene.agents = (scene.agents || []).filter(a => a !== pkg);
  scene.skills = (scene.skills || []).filter(s => s !== pkg);
  const after = (scene.agents || []).length + (scene.skills || []).length;

  if (before === after) {
    console.log(`⚠️  '${pkg}' not found in scene`);
    return;
  }

  await saveScene(targetDir, scene);
  console.log(`✅ Removed '${pkg}' from scene '${scene.name}'`);
}

export async function installScene(dir?: string): Promise<void> {
  const targetDir = dir || process.cwd();
  const scene = await loadScene(targetDir);

  console.log(`🎬 Installing scene '${scene.name}'...\n`);

  // Install agents
  for (const agent of (scene.agents || [])) {
    try {
      const meta = await install(agent, targetDir, 'agent');
      if (meta) console.log(`  ✅ Agent: ${meta.name}@${meta.version}`);
    } catch (err) {
      console.error(`  ❌ Agent '${agent}': ${(err as Error).message}`);
    }
  }

  // Install skills
  for (const skill of (scene.skills || [])) {
    try {
      const meta = await install(skill, targetDir);
      if (meta) console.log(`  ✅ Skill: ${meta.name}@${meta.version}`);
    } catch (err) {
      console.error(`  ❌ Skill '${skill}': ${(err as Error).message}`);
    }
  }

  // Merge env vars
  if (scene.env && Object.keys(scene.env).length > 0) {
    const envPath = path.join(targetDir, '.env');
    const existing: Record<string, string> = {};

    if (await fs.pathExists(envPath)) {
      for (const line of (await fs.readFile(envPath, 'utf-8')).split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [key, ...valParts] = trimmed.split('=');
        if (key) existing[key.trim()] = valParts.join('=').trim();
      }
    }

    const merged = { ...existing, ...scene.env };
    const content = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n');
    await fs.writeFile(envPath, content + '\n');
    console.log(`  ✅ Env: ${Object.keys(scene.env).length} variable(s) merged → .env`);
  }

  console.log(`\n🎉 Scene '${scene.name}' installation complete`);
}

export async function list(dir?: string): Promise<void> {
  const targetDir = dir || process.cwd();
  const scene = await loadScene(targetDir);

  console.log(`🎬 Scene: ${scene.name}`);
  if (scene.description) console.log(`   ${scene.description}`);
  console.log();

  console.log('  Agents:');
  for (const a of (scene.agents || [])) {
    console.log(`    🤖 ${a}`);
  }
  if (!(scene.agents || []).length) console.log('    (none)');

  console.log('  Skills:');
  for (const s of (scene.skills || [])) {
    console.log(`    🧩 ${s}`);
  }
  if (!(scene.skills || []).length) console.log('    (none)');

  if (scene.env && Object.keys(scene.env).length > 0) {
    console.log('  Env:');
    for (const [k, v] of Object.entries(scene.env)) {
      console.log(`    🔑 ${k}=${v}`);
    }
  }
}

export async function validate(dir?: string): Promise<boolean> {
  const targetDir = dir || process.cwd();
  const scenePath = path.join(targetDir, SCENE_FILE);

  if (!(await fs.pathExists(scenePath))) {
    console.log(`❌ No scene file found: ${scenePath}`);
    return false;
  }

  const scene = await readJson<SceneConfig>(scenePath);
  if (!scene || !scene.name || typeof scene.name !== 'string') {
    console.log('❌ Invalid scene: missing "name" field');
    return false;
  }

  const errors: string[] = [];
  if (scene.agents && !Array.isArray(scene.agents)) errors.push('agents must be an array');
  if (scene.skills && !Array.isArray(scene.skills)) errors.push('skills must be an array');
  if (scene.env && typeof scene.env !== 'object') errors.push('env must be an object');

  if (errors.length > 0) {
    console.log('❌ Validation errors:');
    for (const e of errors) console.log(`   - ${e}`);
    return false;
  }

  console.log(`✅ Scene '${scene.name}' is valid`);
  console.log(`   ${scene.agents?.length || 0} agent(s), ${scene.skills?.length || 0} skill(s), ${Object.keys(scene.env || {}).length} env var(s)`);
  return true;
}

async function loadScene(dir: string): Promise<SceneConfig> {
  const scenePath = path.join(dir, SCENE_FILE);
  const scene = await readJson<SceneConfig>(scenePath);
  if (!scene) {
    throw new Error(`No scene file found. Run 'claw scene init' first.`);
  }
  return scene;
}

async function saveScene(dir: string, scene: SceneConfig): Promise<void> {
  const scenePath = path.join(dir, SCENE_FILE);
  await writeJson(scenePath, scene);
}
