// Package install/uninstall/verify

import fs from 'fs-extra';
import path from 'path';
import readline from 'readline';
import { PackageMeta, InstalledPackage, VerifyResult } from './types.js';
import { pkgDir, installedDir, ensureDir, copyDir, readJson, writeJson, isPathVar, suggestDefault, parsePkgRef, OPENCLAW_DIR, OPENCLAW_CONFIG, OPENCLAW_AGENTS_DIR, OPENCLAW_SKILLS_DIR } from './utils.js';
import { fetch_ } from './registry.js';

export async function install(pkgRef: string, projectDir?: string, scope?: 'skill' | 'agent'): Promise<PackageMeta | null> {
  const [name, version] = parsePkgRef(pkgRef);
  const meta = await fetch_(name, version);
  if (!meta) {
    return null;  // Not found in local registry, caller should try sync
  }

  const actualScope = scope || meta.type || 'skill';
  const dest = installedDir(actualScope, name);
  const regDir = pkgDir(actualScope, name);

  await ensureDir(dest);

  // Copy from registry
  if (await fs.pathExists(regDir)) {
    for (const entry of await fs.readdir(regDir)) {
      const src = path.join(regDir, entry);
      const dst = path.join(dest, entry);
      if ((await fs.stat(src)).isDirectory()) {
        await fs.copy(src, dst, { overwrite: true });
      } else {
        await fs.copy(src, dst, { overwrite: true });
      }
    }
  }

  // Interactive env setup
  await checkEnvSetup(dest, name);

  // Deploy to OpenClaw
  if (actualScope === 'agent') {
    await deployAgentToOpenClaw(name, dest);
    await updateOpenClawConfig(name);
  } else if (actualScope === 'skill') {
    await deploySkillToOpenClaw(name, dest);
  }

  return meta;
}

// --- OpenClaw deployment functions ---

async function deployAgentToOpenClaw(name: string, installedDir: string): Promise<void> {
  const targetDir = path.join(OPENCLAW_AGENTS_DIR, name, 'workspace');
  await fs.ensureDir(targetDir);
  await fs.copy(installedDir, targetDir, { overwrite: true });
  console.log(`  ✅ Deployed to ~/.openclaw/agents/${name}/workspace/`);
}

async function deploySkillToOpenClaw(name: string, installedDir: string, targetAgent?: string): Promise<void> {
  let targetDir: string;
  if (targetAgent) {
    // Agent's skill
    targetDir = path.join(OPENCLAW_AGENTS_DIR, targetAgent, 'skills', name);
  } else {
    // Shared skill
    targetDir = path.join(OPENCLAW_SKILLS_DIR, name);
  }
  await fs.ensureDir(targetDir);
  await fs.copy(installedDir, targetDir, { overwrite: true });
  console.log(`  ✅ Deployed to ${targetAgent ? `~/.openclaw/agents/${targetAgent}/skills/${name}/` : `~/.openclaw/workspace/skills/${name}/`}`);
}

async function updateOpenClawConfig(name: string): Promise<void> {
  if (!(await fs.pathExists(OPENCLAW_CONFIG))) return;

  const config = await readJson<Record<string, unknown>>(OPENCLAW_CONFIG);
  if (!config) return;

  if (!config.agents) config.agents = {} as Record<string, unknown>;
  const agents = config.agents as Record<string, unknown>;
  if (!agents.list) agents.list = [];

  const list = agents.list as Array<Record<string, unknown>>;
  // Check if already exists
  if (list.some(a => a.id === name)) {
    console.log(`  ℹ️  Agent '${name}' already in openclaw.json`);
    return;
  }

  // Add new agent
  list.push({
    id: name,
    name: name,
    workspace: path.join(OPENCLAW_AGENTS_DIR, name, 'workspace'),
    agentDir: path.join(OPENCLAW_AGENTS_DIR, name, 'workspace'),
    model: { primary: 'inherit' }
  });

  await writeJson(OPENCLAW_CONFIG, config);
  console.log(`  ✅ Added to openclaw.json agents.list`);
}

async function removeFromOpenClawConfig(name: string): Promise<void> {
  if (!(await fs.pathExists(OPENCLAW_CONFIG))) return;

  const config = await readJson<Record<string, unknown>>(OPENCLAW_CONFIG);
  if (!config || !config.agents) return;

  const agents = config.agents as Record<string, unknown>;
  if (!agents.list) return;

  const list = agents.list as Array<Record<string, unknown>>;
  const idx = list.findIndex(a => a.id === name);
  if (idx >= 0) {
    list.splice(idx, 1);
    await writeJson(OPENCLAW_CONFIG, config);
    console.log(`  ✅ Removed from openclaw.json agents.list`);
  }
}



async function checkEnvSetup(installedDir: string, pkgName: string): Promise<void> {
  const envExample = path.join(installedDir, '.env.example');
  if (!(await fs.pathExists(envExample))) return;
  
  const content = await fs.readFile(envExample, 'utf-8');
  const vars: string[] = [];
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!trimmed.includes('=')) continue;
    const key = trimmed.split('=')[0].trim();
    if (key) vars.push(key);
  }
  
  if (vars.length === 0) return;
  
  // Load existing .env
  const envPath = path.join(installedDir, '.env');
  const existing: Record<string, string> = {};
  if (await fs.pathExists(envPath)) {
    for (const line of (await fs.readFile(envPath, 'utf-8')).split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...valParts] = trimmed.split('=');
      if (key) existing[key.trim()] = valParts.join('=').trim();
    }
  }
  
  // Filter new vars
  const newVars = vars.filter(v => !(v in existing));
  if (newVars.length === 0) return;
  
  console.log(`\n🔧 Setting up environment for ${pkgName}`);
  console.log(`   (${newVars.length} variable(s) to configure)\n`);
  
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  for (const varName of newVars) {
    const isPath = isPathVar(varName);
    const defaultVal = isPath ? suggestDefault(varName) : '';
    const prompt = isPath 
      ? `  📍 ${varName} [${defaultVal}]: `
      : `  🔑 ${varName}: `;
    
    const answer = await new Promise<string>(resolve => {
      rl.question(prompt, resolve);
    });
    
    existing[varName] = answer.trim() || defaultVal;
  }
  
  rl.close();
  
  // Write .env
  const envContent = [`# Env for ${pkgName}`, ...Object.entries(existing).map(([k, v]) => `${k}=${v}`)].join('\n');
  await fs.writeFile(envPath, envContent + '\n');
  console.log(`  ✅ Saved to ${envPath}\n`);
}

export async function uninstall(name: string): Promise<void> {
  for (const scope of ['skill', 'agent'] as const) {
    const dir = installedDir(scope, name);
    if (await fs.pathExists(dir)) {
      await fs.remove(dir);

      // Clean up OpenClaw directories
      if (scope === 'agent') {
        const agentDir = path.join(OPENCLAW_AGENTS_DIR, name);
        if (await fs.pathExists(agentDir)) {
          await fs.remove(agentDir);
          console.log(`  ✅ Removed ~/.openclaw/agents/${name}/`);
        }
        await removeFromOpenClawConfig(name);
      } else {
        const skillDir = path.join(OPENCLAW_SKILLS_DIR, name);
        if (await fs.pathExists(skillDir)) {
          await fs.remove(skillDir);
          console.log(`  ✅ Removed ~/.openclaw/workspace/skills/${name}/`);
        }
      }
      return;
    }
  }
}

export async function listInstalled(): Promise<InstalledPackage[]> {
  const pkgs: InstalledPackage[] = [];
  const seen = new Set<string>();

  // Check claw installed packages
  const baseDir = path.dirname(installedDir('skill', ''));
  if (await fs.pathExists(baseDir)) {
    for (const entry of await fs.readdir(baseDir)) {
      if (!entry.includes('__')) continue;
      const [scope, name] = entry.split('__') as ['skill' | 'agent', string];
      const pkgPath = path.join(baseDir, entry, 'package.json');
      const data = await readJson<Record<string, unknown>>(pkgPath);
      if (data) {
        seen.add(`${scope}/${name}`);
        pkgs.push({
          name: data.name as string,
          version: (data.version as string) || '1.0.0',
          scope,
          description: data.description as string,
        });
      }
    }
  }

  // Check OpenClaw agents directory
  if (await fs.pathExists(OPENCLAW_AGENTS_DIR)) {
    for (const entry of await fs.readdir(OPENCLAW_AGENTS_DIR)) {
      if (seen.has(`agent/${entry}`)) continue;
      const workspaceDir = path.join(OPENCLAW_AGENTS_DIR, entry, 'workspace');
      const pkgPath = path.join(workspaceDir, 'package.json');
      const data = await readJson<Record<string, unknown>>(pkgPath);
      if (data) {
        seen.add(`agent/${entry}`);
        pkgs.push({
          name: data.name as string || entry,
          version: (data.version as string) || '1.0.0',
          scope: 'agent',
          description: data.description as string,
        });
      } else if (await fs.pathExists(workspaceDir)) {
        // Agent exists but no package.json
        seen.add(`agent/${entry}`);
        pkgs.push({
          name: entry,
          version: '1.0.0',
          scope: 'agent',
          description: '(deployed to OpenClaw)',
        });
      }
    }
  }

  // Check OpenClaw skills directory
  if (await fs.pathExists(OPENCLAW_SKILLS_DIR)) {
    for (const entry of await fs.readdir(OPENCLAW_SKILLS_DIR)) {
      if (seen.has(`skill/${entry}`)) continue;
      const skillDir = path.join(OPENCLAW_SKILLS_DIR, entry);
      const pkgPath = path.join(skillDir, 'package.json');
      const data = await readJson<Record<string, unknown>>(pkgPath);
      if (data) {
        seen.add(`skill/${entry}`);
        pkgs.push({
          name: data.name as string || entry,
          version: (data.version as string) || '1.0.0',
          scope: 'skill',
          description: data.description as string,
        });
      } else if (await fs.pathExists(skillDir)) {
        // Skill exists but no package.json
        seen.add(`skill/${entry}`);
        pkgs.push({
          name: entry,
          version: '1.0.0',
          scope: 'skill',
          description: '(deployed to OpenClaw)',
        });
      }
    }
  }

  return pkgs;
}

export async function verify(): Promise<VerifyResult[]> {
  const results: VerifyResult[] = [];
  const pkgs = await listInstalled();
  
  for (const pkg of pkgs) {
    const dir = installedDir(pkg.scope, pkg.name);
    if (!(await fs.pathExists(dir))) {
      results.push({ name: pkg.name, scope: pkg.scope, ok: false, actual: '(missing)' });
      continue;
    }
    
    const hasPkgJson = await fs.pathExists(path.join(dir, 'package.json'));
    const hasMd = await fs.pathExists(path.join(dir, 'SKILL.md')) || 
                  await fs.pathExists(path.join(dir, 'SOUL.md'));
    
    results.push({
      name: pkg.name,
      scope: pkg.scope,
      ok: hasPkgJson && hasMd,
      actual: (hasPkgJson && hasMd) ? 'ok' : 'incomplete',
    });
  }
  
  return results;
}

// Agent-specific functions
export async function agentInstall(name: string, projectDir?: string): Promise<PackageMeta | null> {
  return install(name, projectDir, 'agent');
}

export async function agentSoul(name: string): Promise<string> {
  // Check installed directory first
  const installedAgentDir = installedDir('agent', name);
  const installedSoulPath = path.join(installedAgentDir, 'SOUL.md');
  if (await fs.pathExists(installedSoulPath)) {
    return await fs.readFile(installedSoulPath, 'utf-8');
  }

  // Also check OpenClaw agents workspace directory
  const openclawWorkspaceDir = path.join(OPENCLAW_AGENTS_DIR, name, 'workspace');
  const openclawSoulPath = path.join(openclawWorkspaceDir, 'SOUL.md');
  if (await fs.pathExists(openclawSoulPath)) {
    return await fs.readFile(openclawSoulPath, 'utf-8');
  }

  throw new Error(`Agent '${name}' has no SOUL.md`);
}