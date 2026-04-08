# claw update — Self-Update Command Design

## Summary

Add a `claw update` command that checks for and applies updates to the claw CLI itself. It detects whether claw was installed via npm or GitHub source, then uses the appropriate update mechanism.

## Command Interface

```
claw update           # Check for update and apply if available
claw update --check   # Only check, print result, do not update
```

## Architecture

New module: `src/updater.ts` — contains all update logic. Registered in `src/cli.ts` and re-exported from `src/index.ts`.

### Detection: `detectInstallMethod()`

Uses `fs.realpathSync` on the `claw` binary path (from `process.argv[1]`) to resolve symlinks:

| Resolved path pattern | Install method |
|---|---|
| Contains `node_modules/.bin/` | npm global |
| Path is inside a git repo (`.git` exists in ancestor dir) | GitHub source |
| Neither | unknown |

Returns `'npm' | 'github' | 'unknown'`.

### Version comparison: `checkForUpdate(method)`

| Method | Current version | Remote version |
|---|---|---|
| npm | Read `package.json` `version` field adjacent to `cli.js` | `npm view openclaw-claw version` (stdout, trimmed) |
| github | Read `package.json` `version` field adjacent to `cli.js` | `git ls-remote --tags --sort=-v:refname origin` in repo dir, extract latest semver tag, strip `v` prefix |

Uses `semver.gt(remote, current)` from the existing `semver` dependency.

Returns `{ current: string, latest: string, needsUpdate: boolean }`.

### Update execution: `performUpdate(method)`

**npm:**
```
npm update -g openclaw-claw
```
Post-update: re-read version from updated `package.json` to confirm.

**GitHub:**
```
cd <repo-dir> && git pull --ff-only && npm install && npx tsc
```
Post-update: re-read version from updated `package.json` to confirm.

`--check` flag skips this step entirely.

### Main function: `update(options)`

```
1. Print current version
2. Detect install method
3. If unknown → print manual update instructions, exit 0
4. Fetch remote version
5. If already latest → print "Already up to date", exit 0
6. If --check → print "Update available: v... → v...", exit 0
7. Perform update
8. Verify new version
9. Print success message
```

## Error Handling

| Scenario | Behavior |
|---|---|
| Network failure (npm view / git ls-remote) | Print friendly error, exit 1 |
| Permission denied (npm global) | Print hint about `--prefix` or user-level npm dir |
| `git pull` fails (conflicts, etc) | Print error suggesting manual `git pull`, exit 1 |
| `npm install` or `tsc` fails (GitHub) | Print error, exit 1 |
| Version unchanged after update | Print warning that update may not have applied |

## File Changes

| File | Change |
|---|---|
| `src/updater.ts` | **New** — `detectInstallMethod()`, `checkForUpdate()`, `performUpdate()`, `update()` |
| `src/cli.ts` | **Modify** — Register `update` command with `--check` option |
| `src/index.ts` | **Modify** — Re-export `update` from `updater.js` |

## CLI Registration (cli.ts)

```typescript
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
```

## Constraints

- No new dependencies — uses existing `child_process.execSync`, `fs`, `semver`
- macOS and Linux only (matches existing setup.sh scope)
- `execSync` calls wrapped with try/catch and meaningful error messages
- GitHub update uses `--ff-only` to avoid creating merge commits
