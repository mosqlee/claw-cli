#!/usr/bin/env node
// Claw CLI - Package Manager for OpenClaw Skills & Agents

import fs from 'fs-extra';
import path from 'path';
import { Command } from 'commander';
import { fileURLToPath } from 'url';

// Read version from package.json
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.join(__dirname, '..', 'package.json');
const pkgJson = await fs.readJson(pkgPath);
const CLI_VERSION = pkgJson.version;

import { publish, fetch_, search, searchRemote, syncRegistry } from './registry.js';
import { install, uninstall, listInstalled, verify, agentInstall, agentSoul } from './package.js';
import { pack, installPack } from './packer.js';
import { init as sceneInit, add as sceneAdd, remove as sceneRemove, installScene, list as sceneList, validate as sceneValidate } from './scene.js';
import { showConfig, setConfig } from './config.js';
import { update } from './updater.js';

const program = new Command();

program
  .name('claw')
  .description('Package Manager for OpenClaw Skills & Agents')
  .version(CLI_VERSION);

// ─── Publish ───
program
  .command('publish <source-dir>')
  .description('Publish a package to local registry')
  .option('--scope <scope>', 'Force scope (skill or agent)')
  .action(async (sourceDir, options) => {
    try {
      const meta = await publish(sourceDir, options.scope);
      if (meta) {
        console.log(`✅ Published ${meta.type}/${meta.name}@${meta.version}`);
      }
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── Search ───
program
  .command('search [query]')
  .description('Search for packages in local registry and remote repos')
  .option('--local', 'Only search local registry')
  .action(async (query, options) => {
    try {
      const results = options.local ? await search(query || '') : await searchRemote(query || '');
      for (const r of results) {
        const remote = (r as any).source === 'remote' ? ' 🌐' : '';
        console.log(`  📦 ${r.name}@${r.version} [${r.scope}] ${r.description || ''}${remote}`);
      }
      if (results.length === 0) {
        console.log('No packages found.');
      }
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── Install ───
program
  .command('install <package>')
  .description('Install a package from registry')
  .action(async (pkg) => {
    try {
      let meta = await install(pkg, process.cwd());
      if (meta) {
        console.log(`✅ Installed ${meta.type}/${meta.name}@${meta.version}`);
        return;
      }
      // Not found locally - try pulling registry first
      console.log('📦 Package not in local cache, pulling registry...');
      await syncRegistry();
      meta = await install(pkg, process.cwd());
      if (meta) {
        console.log(`✅ Installed ${meta.type}/${meta.name}@${meta.version}`);
      } else {
        console.log(`❌ Package '${pkg}' not found in registry`);
      }
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── Uninstall ───
program
  .command('uninstall <name>')
  .description('Uninstall a package')
  .action(async (name) => {
    try {
      await uninstall(name);
      console.log(`✅ Uninstalled '${name}'`);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── List ───
program
  .command('list')
  .description('List installed packages')
  .action(async () => {
    try {
      const pkgs = await listInstalled();
      for (const p of pkgs) {
        console.log(`  📦 ${p.name}@${p.version} [${p.scope}] ${p.description || ''}`);
      }
      if (pkgs.length === 0) {
        console.log('No packages installed.');
      }
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── Verify ───
program
  .command('verify')
  .description('Verify installed packages')
  .action(async () => {
    try {
      const results = await verify();
      if (results.length === 0) {
        console.log('No packages installed.');
        return;
      }
      
      let allOk = true;
      for (const r of results) {
        const icon = r.ok ? '✅' : '❌';
        console.log(`  ${icon} ${r.name} [${r.scope}]`);
        if (!r.ok) allOk = false;
      }
      
      console.log();
      if (allOk) {
        console.log('✅ All packages verified.');
      } else {
        console.log('❌ Some packages have issues.');
        process.exit(1);
      }
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── Pack ───
program
  .command('pack <name>')
  .description('Create offline tarball from installed package')
  .option('--output <dir>', 'Output directory', '.')
  .action(async (name, options) => {
    try {
      const tarball = await pack(name, options.output);
      console.log(`✅ Packed to ${tarball}`);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── Agent commands ───
const agentCmd = program
  .command('agent')
  .description('Agent management commands');

agentCmd
  .command('install <name>')
  .description('Install an agent')
  .action(async (name) => {
    try {
      let meta = await agentInstall(name, process.cwd());
      if (meta) {
        console.log(`✅ Agent '${name}' v${meta.version} installed`);
        return;
      }
      // Not found locally - try pulling registry first
      console.log('📦 Agent not in local cache, pulling registry...');
      await syncRegistry();
      meta = await agentInstall(name, process.cwd());
      if (meta) {
        console.log(`✅ Agent '${name}' v${meta.version} installed`);
      } else {
        console.log(`❌ Agent '${name}' not found in registry`);
      }
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

agentCmd
  .command('soul <name>')
  .description('Show agent SOUL.md')
  .action(async (name) => {
    try {
      const soul = await agentSoul(name);
      console.log(soul);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── Config commands ───
const configCmd = program
  .command('config')
  .description('Configuration management');

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value')
  .action(async (key, value) => {
    try {
      await setConfig(key, value);
      console.log(`✅ Set ${key} = ${value}`);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(async () => {
    await showConfig();
  });

configCmd
  .command('list')
  .description('Show current configuration (alias for show)')
  .action(async () => {
    await showConfig();
  });

// ─── Scene commands ───
const sceneCmd = program
  .command('scene')
  .description('Scene management commands');

sceneCmd
  .command('init [name]')
  .description('Initialize a scene configuration')
  .option('--desc <description>', 'Scene description')
  .option('--dir <path>', 'Target directory')
  .action(async (name, options) => {
    try {
      await sceneInit(name || 'default', options.desc, options.dir);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

sceneCmd
  .command('add <package>')
  .description('Add a package to the current scene')
  .option('--dir <path>', 'Target directory')
  .action(async (pkg, options) => {
    try {
      await sceneAdd(pkg, options.dir);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

sceneCmd
  .command('remove <package>')
  .description('Remove a package from the current scene')
  .option('--dir <path>', 'Target directory')
  .action(async (pkg, options) => {
    try {
      await sceneRemove(pkg, options.dir);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

sceneCmd
  .command('install')
  .description('Install all packages from scene configuration')
  .option('--dir <path>', 'Target directory')
  .action(async (options) => {
    try {
      await installScene(options.dir);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

sceneCmd
  .command('list')
  .description('Show current scene configuration')
  .option('--dir <path>', 'Target directory')
  .action(async (options) => {
    try {
      await sceneList(options.dir);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

sceneCmd
  .command('validate')
  .description('Validate scene configuration file')
  .option('--dir <path>', 'Target directory')
  .action(async (options) => {
    const ok = await sceneValidate(options.dir);
    if (!ok) process.exit(1);
  });

// ─── Update (self-update) ───
program
  .command('update')
  .description('Update claw CLI to the latest version')
  .option('--check', 'Only check for updates, do not install')
  .action(async (options) => {
    try {
      await update(options);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── Doctor ───
program
  .command('doctor')
  .description('Check environment')
  .action(() => {
    console.log('📋 Environment Check');
    console.log();
    console.log('  ✅ Node.js', process.version);
    console.log('  ✅ claw-cli', CLI_VERSION);
  });

// ─── Install Pack ───
program
  .command('install-pack <tarball>')
  .description('Install package from offline tarball')
  .action(async (tarball) => {
    try {
      const { installPack } = await import('./packer.js');
      await installPack(tarball);
      console.log(`✅ Installed from ${tarball}`);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── Env commands ───
const envCmd = program
  .command('env')
  .description('Environment management');

envCmd
  .command('check')
  .description('Check environment tools')
  .action(() => {
    console.log('📋 Environment Check');
    console.log();
    console.log('  ✅ Node.js', process.version);
  });

envCmd
  .command('setup')
  .description('Setup project environment')
  .action(() => {
    console.log('✅ Environment setup complete');
  });

program.parse();