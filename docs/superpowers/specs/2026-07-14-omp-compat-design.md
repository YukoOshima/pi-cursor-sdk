# Design: oh-my-pi (omp) Compatibility for pi-cursor-sdk

Date: 2026-07-14  
Repo: https://github.com/YukoOshima/pi-cursor-sdk  
Target host: omp v16.5.0 (`@oh-my-pi/pi-coding-agent`)

## Goal

Make this fork load and run as an omp plugin/extension while preserving existing stock-pi (`@earendil-works/pi-coding-agent`) behavior as much as practical. After verification, commit and push.

## Problem

Loading the current package into omp fails:

```
Failed to load extension: Export named 'CONFIG_DIR_NAME' not found in module
'.../legacy-pi-coding-agent-shim.ts'
```

omp remaps `@earendil-works/*` / `@mariozechner/*` onto `@oh-my-pi/*`, but its coding-agent shim does not re-export every symbol this extension imports. Additional drift exists for:

- `CONFIG_DIR_NAME` (lives in `@oh-my-pi/pi-utils`, not coding-agent shim)
- `pi-ai/compat` subpath (exists in earendil-works pi-ai; not a real omp pi-ai export)
- Docs/paths that hard-code `~/.pi` / `.pi` while omp uses `~/.omp` / `.omp`
- Package metadata that only declares a `pi` plugin field (omp accepts `omp || pi`, but dual declaration is clearer)

## Chosen approach

**Compat-layer migration (approved):** keep the extension architecture, fix host API/path/package mismatches so one package works under omp and remains usable under stock pi where possible.

Rejected alternatives:

1. Full rewrite onto omp built-in Cursor transport — loses Cursor SDK agent loop.
2. Fork-and-vendored omp-only package with no stock-pi support — unnecessary split.

## Design

### 1. Host import compatibility

Introduce a tiny local host-compat module (or surgically replace imports) so runtime does not depend on missing coding-agent shim exports.

Required behavior:

- Resolve `CONFIG_DIR_NAME` safely under omp (prefer `@oh-my-pi/pi-utils`, fall back to coding-agent export under stock pi, ultimate fallback `".pi"` / host-appropriate default).
- Keep using `getAgentDir()` from coding-agent/shim so caches land in the active agent dir (`~/.omp/agent` under omp, `~/.pi/agent` under stock pi).
- Replace `@earendil-works/pi-ai/compat` imports with a host-safe surface:
  - Prefer package-root types/APIs that omp's pi-ai shim exports, **or**
  - Add a local `src/host-pi-ai.ts` re-export facade that works under both hosts.

Do **not** rewrite every import to hard-coded `@oh-my-pi/*` only; keep `@earendil-works/*` peerDependencies for stock pi, relying on omp's legacy remapper, plus local facades for missing exports.

### 2. Package metadata

Update `package.json`:

- Keep `pi.extensions = ["./src/index.ts"]`
- Add `omp.extensions = ["./src/index.ts"]`
- Keep peers on `@earendil-works/pi-*` (omp remaps them)
- Document omp install via `omp install` / `omp plugin link`
- Bump version to `0.1.58` with changelog note

### 3. Path / docs dual-host wording

- Runtime path construction must use `getAgentDir()` / `CONFIG_DIR_NAME`, never hard-coded `~/.pi`.
- Docs should mention both pi and omp paths: `~/.pi/agent` **or** `~/.omp/agent`, project config under `.pi/` **or** `.omp/`.
- README install section should include `omp install` / `omp plugin link` examples.

### 4. Provider coexistence with omp built-in Cursor

omp already ships a built-in Cursor OAuth/provider transport. This extension registers provider id `cursor` via `registerProvider`, which **replaces** models for that provider.

Document this clearly:

- Installing this plugin intentionally overrides omp's stock Cursor model catalog with Cursor-SDK-backed models.
- Users who want stock omp Cursor behavior should uninstall/disable this plugin.

No rename of provider id in v1 (avoids breaking `cursor/...` model IDs and auth keys).

### 5. Verification

Minimum verification gate before commit/push:

1. `npm install`
2. Unit/type gates: `npm run typecheck` and focused/full `npm test` as feasible
3. omp load smoke: `omp -e <repo> --no-session -p "ping"` must not log `Failed to load extension`
4. Optional live model reply smoke only if auth available

### 6. Git delivery

- Branch `omp-compat-migration`
- Commit and push to origin (YukoOshima/pi-cursor-sdk)

## Non-goals

- Replacing Cursor SDK runtime with omp native Cursor HTTP/2 transport
- Changing provider name away from `cursor`
- Publishing to npm
- Fixing unrelated omp MCP/model-discovery warnings

## Success criteria

- Extension loads under omp without missing-export errors
- Config/cache files resolve under omp agent dir
- Package installs via omp plugin tooling
- Changes committed and pushed to GitHub fork
