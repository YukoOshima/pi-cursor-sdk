# pi-cursor-sdk omp Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pi-cursor-sdk` load and run under oh-my-pi (omp) while keeping stock-pi compatibility, then verify, commit, and push.

**Architecture:** Keep the Cursor-SDK provider extension. Add thin host-compat helpers for symbols/paths omp’s coding-agent shim does not export, rewrite `pi-ai/compat` imports to the remappable package root, dual-declare `omp`/`pi` plugin manifests, and dual-document `~/.pi` vs `~/.omp` paths.

**Tech Stack:** TypeScript ESM extension, `@cursor/sdk`, `@earendil-works/pi-*` peers (remapped by omp to `@oh-my-pi/*`), vitest, omp CLI.

**Spec:** `docs/superpowers/specs/2026-07-14-omp-compat-design.md`

**Working directory:** `/Users/bytedance/Code/pi-cursor-sdk` on branch `omp-compat-migration`

---

## File map

| File | Responsibility |
| --- | --- |
| `src/host-agent-paths.ts` (new) | Host-safe `CONFIG_DIR_NAME` + re-export `getAgentDir` derived from active agent dir |
| `src/cursor-config.ts` | Stop importing `CONFIG_DIR_NAME` from coding-agent; use host helper |
| `src/context-window-cache.ts` / `src/model-list-cache.ts` / `src/cursor-agents-context.ts` | Keep `getAgentDir` via host helper or coding-agent (both OK if export exists) |
| All `src/**` + `test/**` importing `@earendil-works/pi-ai/compat` | Switch to `@earendil-works/pi-ai` (omp remaps package root; `/compat` breaks under omp) |
| `package.json` | Add `omp.extensions`, bump to `0.1.58`, note omp support |
| `CHANGELOG.md` / `README.md` / `AGENTS.md` | Dual-host install/path docs + override warning vs omp built-in Cursor |
| `.gitignore` | Keep `.worktrees/` ignore if added |

---

### Task 1: Host path helper for CONFIG_DIR_NAME

**Files:**
- Create: `src/host-agent-paths.ts`
- Create: `test/host-agent-paths.test.ts`
- Modify: `src/cursor-config.ts`

- [ ] **Step 1: Write the failing test**

```ts
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => path.join("/tmp/fake-home", ".omp", "agent"),
}));

describe("host-agent-paths", () => {
  it("derives CONFIG_DIR_NAME from getAgentDir parent", async () => {
    const mod = await import("../src/host-agent-paths.js");
    expect(mod.CONFIG_DIR_NAME).toBe(".omp");
    expect(mod.getAgentDir()).toContain(`${path.sep}.omp${path.sep}agent`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/host-agent-paths.test.ts`  
Expected: FAIL because module missing.

- [ ] **Step 3: Implement helper**

```ts
import path from "node:path";
import { getAgentDir as getHostAgentDir } from "@earendil-works/pi-coding-agent";

function deriveConfigDirName(agentDir: string): string {
  const parent = path.basename(path.dirname(path.resolve(agentDir)));
  if (parent === ".omp" || parent === ".pi") return parent;
  if (typeof process.env.PI_CONFIG_DIR === "string" && process.env.PI_CONFIG_DIR.trim()) {
    return process.env.PI_CONFIG_DIR.trim();
  }
  return ".pi";
}

export function getAgentDir(): string {
  return getHostAgentDir();
}

export const CONFIG_DIR_NAME: string = deriveConfigDirName(getAgentDir());
```

- [ ] **Step 4: Update `src/cursor-config.ts` imports**

Replace:
`import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";`  
with:
`import { CONFIG_DIR_NAME, getAgentDir } from "./host-agent-paths.js";`

- [ ] **Step 5: Re-run test**

Run: `npx vitest run test/host-agent-paths.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/host-agent-paths.ts test/host-agent-paths.test.ts src/cursor-config.ts
git commit -m "fix: derive CONFIG_DIR_NAME for omp coding-agent shim"
```

---

### Task 2: Rewrite pi-ai/compat imports

**Files:**
- Modify: every file under `src/` and `test/` that imports `@earendil-works/pi-ai/compat`
- Modify: `test/package-metadata.test.ts` only if it asserts compat path strings

- [ ] **Step 1: Inventory imports**

Run: `rg -n "@earendil-works/pi-ai/compat" src test scripts || true`

- [ ] **Step 2: Replace imports**

Mechanically replace:
`from "@earendil-works/pi-ai/compat"` → `from "@earendil-works/pi-ai"`  
Keep type-only vs value import style unchanged.

Rationale: omp remaps `@earendil-works/pi-ai` to its package-root shim; `/compat` is not a real omp export and breaks extension load after the CONFIG_DIR_NAME fix.

- [ ] **Step 3: Smoke type/import check**

Run focused tests that import provider modules, e.g.:
`npx vitest run test/cursor-provider-stream-config.test.ts test/context.test.ts`

Expected: no module-not-found for `pi-ai/compat`.

- [ ] **Step 4: Commit**

```bash
git add src test
git commit -m "fix: import pi-ai package root instead of /compat for omp"
```

---

### Task 3: Package metadata + docs dual-host support

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `.gitignore` (ensure `.worktrees/` present)

- [ ] **Step 1: Update package.json**

- Bump `version` to `0.1.58`
- Keep existing `pi.extensions`
- Add:
```json
"omp": {
  "extensions": ["./src/index.ts"]
}
```
- Update description to mention omp + pi
- Keep `@earendil-works/pi-*` peers

- [ ] **Step 2: CHANGELOG entry for 0.1.58**

Note: omp load fix, CONFIG_DIR_NAME host helper, pi-ai import change, dual manifest, docs.

- [ ] **Step 3: README / AGENTS updates**

- Install via `omp install` / `omp plugin link <path>` in addition to `pi install`
- Auth/cache paths: `~/.pi/agent` **or** `~/.omp/agent`
- Project config: `.pi/cursor-sdk.json` **or** `.omp/cursor-sdk.json`
- Warning: registering provider `cursor` replaces omp built-in Cursor models

- [ ] **Step 4: Commit**

```bash
git add package.json CHANGELOG.md README.md AGENTS.md .gitignore docs/superpowers
git commit -m "docs: add omp plugin manifest and dual-host install notes"
```

---

### Task 4: Verify under omp, then push

**Files:** none required beyond fixes discovered during verification

- [ ] **Step 1: Install deps**

`npm install`

- [ ] **Step 2: Typecheck + unit tests**

`npm run typecheck`  
`npm test` (or largest green subset if environment blocks full suite; document skips)

- [ ] **Step 3: omp extension load smoke**

```bash
omp --allow-home -e /Users/bytedance/Code/pi-cursor-sdk --no-session -p "Reply with OMP_CURSOR_EXT_OK only."
```

Pass criteria:
- omp log must NOT contain `Failed to load extension` for this package
- ideally command completes; live Cursor auth failures are acceptable if extension loaded

Also check recent log:
`rg "Failed to load extension|pi-cursor-sdk|CONFIG_DIR_NAME" ~/.omp/logs/omp.*.log | tail`

- [ ] **Step 4: Optional plugin link dry-run**

`omp plugin link /Users/bytedance/Code/pi-cursor-sdk --dry-run`

- [ ] **Step 5: Commit any verification fixes, push branch**

```bash
git status
git push -u origin omp-compat-migration
```

If user asked commit and push of the migration itself and branch is ready, push after green verification.

---

## Spec coverage check

- CONFIG_DIR_NAME / host paths → Task 1
- pi-ai/compat → Task 2
- package omp field + docs dual paths + provider override warning → Task 3
- verify + commit/push → Task 4

## Placeholder scan

None intentional.
