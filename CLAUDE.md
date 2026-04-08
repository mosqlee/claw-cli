# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claw is a package manager CLI for OpenClaw Skills and Agents — the AI capability ecosystem. It manages publishing, installing, searching, and bundling AI "skills" and "agents" from a local/remote registry. Written in TypeScript, targets Node.js >= 18, uses ES modules (`"type": "module"`).

## Commands

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Watch mode compilation
npm run test           # Run vitest tests
npm run lint           # ESLint on src/
npx vitest run src/utils.test.ts   # Run a single test file
node dist/cli.js       # Run the CLI locally after building
```

No custom vitest config — uses vitest defaults. Blackbox tests exist in `test-blackbox.sh` (Docker-based).

## Architecture

### Entry Points

- `src/cli.ts` — CLI entry point using Commander.js. All commands registered here with thin action handlers that delegate to modules.
- `src/index.ts` — Re-exports everything from all modules for programmatic use as a library.

### Core Modules (all in `src/`)

| Module | Responsibility |
|--------|---------------|
| `registry.ts` | Publish/fetch/search/sync against the local registry cache and remote GitHub registry repo. Includes secret scanning and env var detection during publish. |
| `package.ts` | Install, uninstall, verify, list installed packages. Handles interactive env var setup during install. Agent-specific install and SOUL.md display. |
| `packer.ts` | Offline tarball creation (`pack`) and installation from tarballs (`installPack`). |
| `scene.ts` | Scene management — a declarative `claw.scene.json` file that bundles skills/agents together. Init, add, remove, install, validate. |
| `config.ts` | Read/write `~/.claw_store/config.json`. |
| `utils.ts` | Shared utilities: file/dir hashing (SHA-256), package ref parsing (`name@version`), env var detection from code (shell/Python/Chinese comments), secret scanning patterns, sensitive file exclusion. |
| `types.ts` | All TypeScript interfaces: `PackageMeta`, `InstalledPackage`, `Lockfile`, `SearchResult`, `SceneConfig`, etc. |

### Storage Layout

```
~/.claw_store/
├── registry/skill/    # Published skill packages
├── registry/agent/    # Published agent packages
├── packages/          # Installed packages (skill__<name>/, agent__<name>/)
└── config.json        # CLI config (registry URLs, etc.)
```

### Key Design Patterns

- **Import style**: All inter-module imports use `.js` extension (required for NodeNext module resolution with ESM).
- **Security during publish**: `utils.ts` detects and replaces secrets (API keys, tokens, passwords, hardcoded paths) with env var references. Sensitive files (`.key`, `.pem`, `.env`, etc.) are excluded automatically.
- **Auto-sync**: `install` command auto-syncs the remote registry when a package isn't found locally.
- **Scopes**: Everything is either `skill` or `agent` scope, determined by `package.json` `type` field or directory structure.
