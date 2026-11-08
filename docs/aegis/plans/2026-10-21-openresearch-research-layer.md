# OpenResearch research layer for DSH — implementation plan

**Status:** approved direction, not started
**Date:** 2026-10-21
**Owner:** repository maintainer
**Baseline:** `dsh-openresearch` 0.1.0 at `22cc31c`; `orx` 0.2.19; DSH desktop 0.2.1-rc.2
**Related:** [OpenResearch parity analysis](../../OPENRESEARCH-PARITY.md) (gap IDs G1–G36)

---

## Aegis Visibility

A durable plan is warranted because this work adds a new owner surface (a client
half), model-facing public tools, and a compatibility contract with both `orx`
and DSH; a slice card cannot carry that handoff or survive a context reset.

---

## 1. Goal and acceptance

### 1.1 Goal

Turn this plugin from a skill catalog into a **research layer**: DSH becomes the
front end for OpenResearch projects, while `orx` remains the system of record and
the only executor. Concretely, after this plan:

1. The model drives the core loop with typed tools — project → tree → create
   child → edit → run → wait → read log — without hand-building shell commands.
2. The user sees the experiment tree, runs, and logs inside DSH, without opening
   `http://127.0.0.1:4791`.
3. Create, launch, cancel, and archive are operable from the UI with confirmation
   and run supervision.
4. Compute status/catalog and literature search are available in-chat.
5. A missing or outdated `orx` produces an actionable doctor result.

### 1.2 Non-goals (contract, not preference)

- No agent runtime, chat, model picker, terminal, file tree, subagents, MCP, or
  session store. DSH owns those.
- No writes to the `orx` SQLite store; no mirror or cache of research state.
- No reimplementation of compute backends, paper retrieval, or the experiment
  engine.
- No standalone desktop app, telemetry backend, or account system.
- No changes to upstream `orx` in this plan. The optional `--json` upstream PR is
  a separate, independently reviewed contribution.

### 1.3 Phase acceptance

| Phase | Acceptance evidence |
| --- | --- |
| 0 | `node --test` green with fixture parsers and a version gate; `docs/notes/dsh-api-spikes.md` answers every open DSH question |
| 1 | A scripted tool session creates a child, launches a local run, waits, and reads its log; the first model request is unchanged |
| 2 | The Research tab renders a real project's tree, runs, and log inside DSH; works with the dashboard API and with the CLI fallback |
| 3 | Create/run/cancel/archive succeed from the UI; a DSH restart shows no orphaned or duplicated runs |
| 4 | Compute status/catalog render; a literature query returns clickable paper cards |
| 5 | A `.tex` file compiles and previews as PDF in DSH |
| 6 | Doctor is green on a healthy machine and actionable on a broken one; update notice works |

---

## 2. Architecture

### 2.1 System shape

```
DSH host
  src/index.mjs                 composition root (skills + new halves)
  src/server/tools.mjs          model-facing tools
  src/server/context.mjs        prompt section + deferred project note
  src/server/api.mjs            /api/openresearch/* routes
  src/server/guards.mjs         optional tool guards
  src/server/orx/*              resolver, exec, parsers, version, client
  src/server/dashboard.mjs      optional dashboard API adapter + sidecar
DSH web client
  src/client/index.js           module loader entry, tab + commands
  src/client/panel.js           tree, runs, logs, actions
  src/client/format.js          pure formatters (testable)
orx 0.2.x
  CLI, `orx serve` (run API), `orx up` (/api + SSE)
```

### 2.2 Ownership

| Concern | Owner | This plan's action |
| --- | --- | --- |
| Research state, Git branches, runs, logs | `orx` | read and invoke only |
| Skill instructions | `orx` (`orx skill`) + `skills-src/openresearch-dsh` | unchanged |
| Model-facing mechanics | this plugin | add tools + prompt section |
| Research UI | this plugin | add client bundle |
| Chat, terminal, files, jobs, model routing | DSH | reuse, never rebuild |
| Plugin discovery | DSH bundle patch | unchanged |

### 2.3 Data sources and precedence

| Source | Data | Stability | Use |
| --- | --- | --- | --- |
| `orx projects --json` | project list | stable | primary |
| `orx project view`, `runs`, `exp status`, `logs` | tree, runs, status, log path | human text | primary, strict parsers |
| `orx serve` `/runs`, `/runs/{id}/logs`, `/event` | run list + live log stream | documented loopback | live tail |
| `orx up` `/api/*` + `/api/events` | full tree, runs, diff, compute | internal, undocumented | optional rich adapter |
| SQLite | everything | internal schema | **never** |

Rules:

1. **One writer.** `orx` is the only writer. The plugin never opens the store for
   writing.
2. **CLI first.** Mutations always go through the CLI. Rich reads may use the
   dashboard API behind `dataSource: auto | cli | api`.
3. **Version gate.** Parse `orx --version` once per process. Outside the tested
   range, degrade to CLI and warn once; never crash the session.
4. **No dashboard requirement.** The agent loop works with the CLI alone. In
   `auto`, reuse a healthy dashboard on the configured port; otherwise fall back
   to CLI. A sidecar is optional and owned by config.
5. **No mirroring.** Every read returns live data. The client may hold it only
   for rendering and must refetch on focus.

### 2.4 Verified DSH surfaces to use

| Surface | API | Confidence |
| --- | --- | --- |
| Tools | `ctx.tools.register(defineTool({...}))` from `@deepseek-ai/dsh-tools` | Verified in package docs |
| Tool policy | `tools/pre-execute` listener | Verified |
| Prompt section | `ctx.systemPrompt.section({ name, order, text })` | Verified |
| Session injection | plugin-authored user message + lifecycle events (Aegis deferral pattern) | Verified in a sibling plugin |
| Right sidebar tab | `ctx.sidebarRightTabs.register(...)` + `ctx.slots.register({ name: 'sidebar.right.pane.tab', key })` | Verified in package docs |
| Slash commands | `ctx.commandUi` contribution | Verified in package docs |
| HTTP route | registered through the `connection` service, as `/api/dsh-context/*` does | **Needs spike (T0.6)** |
| Jobs | DSH jobs service | **Needs spike (T0.6)**; polling fallback |
| Client module | `window.__ModuleLoader__.load({ id, factory(require) { return { name, inject, apply } } })` | Verified in installed plugin |
| Settings card | plugin configuration page via the settings service | Verified in a sibling plugin |

### 2.5 Target repository layout

```
package.json                         modified: client entry, peer deps
src/
  index.mjs                          modified: composition root
  shared/
    contracts.mjs                    new: JSDoc types + constants
    errors.mjs                       new: OrxError taxonomy
    resolve-orx.mjs                  new: extracted resolver (single owner)
  server/
    tools.mjs                        new: registration + descriptions
    tools/read.mjs                   new: projects, tree, runs, logs
    tools/write.mjs                  new: create, run, cancel, wait
    tools/compute.mjs                new (phase 4)
    tools/literature.mjs             new (phase 4)
    context.mjs                      new: prompt section + deferred note
    guards.mjs                       new: optional pre-execute checks
    doctor.mjs                       new: health checks
    api.mjs                          new: route registration
    handlers.mjs                     new: pure request handlers
    dashboard.mjs                    new: API adapter + sidecar
    orx/
      exec.mjs                       new: spawn, timeout, Windows shims
      parse.mjs                      new: pure parsers
      client.mjs                     new: high-level read API
      version.mjs                    new: parse + gate
  client/
    index.js                         new: loader entry, tab, commands
    panel.js                         new: components
    format.js                        new: pure formatters
    styles.js                        new: scoped CSS injection
tests/
  unit/*.test.mjs                    new
  fixtures/*                         new: sanitized real outputs
  integration/orx-smoke.test.mjs     new: gated on ORX_INTEGRATION=1
scripts/
  sync-skills.mjs                    modified: import shared resolver
  capture-fixtures.mjs               new: dev-only fixture capture
```

### 2.6 Package manifest changes

```json
{
  "exports": {
    ".": "./src/index.mjs",
    "./client": "./src/client/index.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": [
        "@deepseek-ai/dsh-client-connection",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-primitives",
        "@deepseek-ai/dsh-client-ui-sidebar-right",
        "@deepseek-ai/dsh-client-ui-commands"
      ]
    },
    "compatibility": { "dsh": ">=0.2.0" }
  }
}
```

Peer dependencies to add (mark optional where a missing package must not disable
the server half):

- `@deepseek-ai/dsh-tools` (`defineTool`)
- `@deepseek-ai/dsh-llm` (message creation, for deferred context)
- `@deepseek-ai/dsh-client-ui-primitives`
- `@deepseek-ai/dsh-client-ui-sidebar-right`
- `@deepseek-ai/dsh-client-ui-commands`
- `@deepseek-ai/dsh-client-connection`
- `react` `^18.3.1`

Use the versions bundled by DSH 0.2.1-rc.2, verified in T0.6: declare
`>=0.2.1-rc.2` for required peers and mark UI peers optional.

`src/index.mjs` keeps `inject = ['skills']` and acquires the optional services
with `ctx.get('tools', false)` / `ctx.inject([...], ...)`, so installing the pack
on a DSH build without a service degrades to skills-only instead of failing to
load.


### 2.7 Compatibility boundary

| Boundary | Commitment |
| --- | --- |
| DSH | 0.2.x; declared through `dsh.compatibility`; client half optional |
| `orx` | `>=0.2.19 <0.3.0`; warn outside, block only on a major/minor mismatch |
| Skills | `skills/` generation and integrity gates unchanged |
| Existing users | No behavior change when the new services are absent |
| Upstream | No fork; read-only consumption of CLI and loopback APIs |

### 2.8 Tech stack

| Layer | Choice | Reason |
| --- | --- | --- |
| Runtime | Node 22.19+ / 24, ESM `.mjs` | matches the existing package and CI matrix |
| Server | plain `node:child_process`, `node:fs`, `node:url`; no HTTP framework | the plugin only shells out and registers routes |
| Client | React 18 via `require('react')` inside the DSH module loader; no JSX build step | keeps the repo buildless; components use a local `h()` alias |
| UI kit | host primitives, theme variables, locale service | no second design system |
| Tests | `node:test`, fixtures, fake `orx` scripts | no test needs network, `orx`, or DSH |
| Packaging | existing DSH bundle patch; `./client` export | no installer or bundler added |

---

## 3. Baseline and authority refs

| Ref | What it establishes |
| --- | --- |
| Conversation turn 2 (Option C + non-goals) | approved direction and scope fence |
| [Parity analysis](../../OPENRESEARCH-PARITY.md) | gap inventory, DSH capability evidence, acceptance sketch |
| `22cc31c` + `package.json` + `src/index.mjs` | current plugin is skills-only; composition point |
| `scripts/sync-skills.mjs` + `tests/` | existing resolver, integrity gates, test style |
| `orx` 0.2.19 help + Appendix A outputs | CLI contract and parser shapes |
| DSH 0.2.1-rc.2 package docs (Appendix B) | tool, prompt, tab, command APIs |
| Baseline usage decision | **continue** — every required ref is present; DSH route/client/jobs APIs are implementation unknowns isolated in T0.6 |

---

## 4. Planning records

### 4.1 Requirement Ready Check

| Item | Evidence |
| --- | --- |
| Requirement source | Conversation: Option C chosen, non-goals stated; parity report §5–§10 |
| Goals / scope | §1 of this plan |
| Scenarios | New user with `orx`; existing project with runs; missing/broken `orx` |
| Acceptance | §1.3 phase table; parity report §10 |
| Open blocker questions | Exact DSH route/client/jobs APIs (implementation unknowns, resolved in T0.6); upstream `--json` (optional) |
| Decision | **ready** — no requirement gap; T0.6 is a gated implementation spike |

### 4.2 Change Necessity

| Item | Statement |
| --- | --- |
| User-visible need | See and drive research in DSH, not in a second browser tab |
| No-change option | Skills + CLI already work for the agent; the human still has no workspace |
| Why code | Tools, routes, and a client panel cannot be delivered by docs/config |
| Minimum boundary | `src/index.mjs` wiring + `src/server/**` + `src/client/**` + manifest + tests |
| Decision | **code-change** |

### 4.3 Ripple Signal Triage

| Signal | Detail |
| --- | --- |
| New public surface | Tool names and `/api/openresearch/*` become contracts |
| New owner | Client half (UI) is new; server half extends `src/index.mjs` |
| Compatibility | DSH peer ranges, `orx` output, dashboard API |
| Persistence | None added (no store, no cache) |
| Retirement | `/orx dashboard` stopgap retires when the panel ships; CLI parsers retire if upstream JSON lands |
| Consumers | DSH model (tools), DSH GUI (client), `orx` (upstream, read-only) |
| Action | Carry version-gate tests, fixture tests, and a manual UI checklist into tasks; no second owner for research state |

### 4.4 Existence Check

| Item | Statement |
| --- | --- |
| Proposed surface | Typed tools, HTTP routes, Research panel, doctor |
| Existing reuse candidates | DSH tools/jobs/terminal/files/deliverables; `orx` CLI/dashboard |
| Why insufficient | DSH has no research objects; the `orx` dashboard is another origin and cannot host chat evidence |
| Creation proof | Option C approved; parity report G1–G36 |
| Entropy / retirement | No duplicated owner; the temporary dashboard embed is explicitly retired by Phase 2 |
| Decision | **add-with-proof** |

### 4.5 Complexity check

| Item | Statement |
| --- | --- |
| Target files | `src/index.mjs` stays a thin composition root; each concern gets its own file under `src/server` and `src/client` |
| Shape pressure | Do not grow `src/index.mjs` past ~80 lines; no parser inside tool modules |
| Add-in-place risk | Low if tools, parsers, and the client stay separate; a monolith would be over budget |
| Recommendation | **add owner files**, keep pure parsers/formatters testable |

### 4.6 Plan Pressure Test

| Item | Result |
| --- | --- |
| Owner / contract / retirement | Plugin owns the research layer; `orx` owns state; stopgap has a retirement trigger |
| Architecture integrity | Reuses DSH surfaces; no second harness |
| Verification scope | Unit fixtures + gated integration + manual GUI checklist |
| Task executability | Each task names files and a command outcome |
| Result | **proceed** |

### 4.7 TDD Route

| Field | Value |
| --- | --- |
| Mode | `off` (Aegis default; no explicit strict request) |
| Decision | `skipped` |
| Authority | User did not request TDD; no project rule requires it |
| Test posture | Contract/regression tests for every parser and handler; integration gated; no RED/GREEN ceremony |
| Verification | `node --test`, `--check --offline`, gated integration, manual checklist |
| Note | If the user later requests strict TDD, apply it from Phase 1 onward without rewriting this plan |

---

## 5. Contracts

### 5.1 Types (JSDoc, `src/shared/contracts.mjs`)

```js
/** @typedef {{ id: string, name: string, path: string, baselineBranch: string }} Project */
/** @typedef {{ id: string, projectId: string, parentId: string|null, title: string,
 *              description: string, branch: string, status: string, archived: boolean,
 *              runCommand: string }} Experiment */
/** @typedef {{ id: string, experimentId: string, status: string, commit: string|null,
 *              durationMs: number|null, updatedAt: number|null }} Run */
/** @typedef {{ path: string, size: number, tail: string, truncated: boolean }} LogSummary */
```

`parentId` is `null` when the CLI cannot expose lineage; the API adapter fills it.
The UI must render a flat list when `parentId` is unknown and say so.

### 5.2 Error taxonomy (`src/shared/errors.mjs`)

| Code | Meaning | User action |
| --- | --- | --- |
| `ORX_MISSING` | binary not found | install `orx` or set `ORX_BIN` |
| `ORX_VERSION_UNSUPPORTED` | outside the gate | upgrade `orx` |
| `ORX_FAILED` | non-zero exit | show stderr tail |
| `ORX_PARSE_FAILED` | output shape changed | run `orx doctor`, report with the raw line |
| `PROJECT_NOT_FOUND` | bad id | refresh the project list |
| `EXPERIMENT_NOT_FOUND` | bad id | refresh the tree |
| `RUN_NOT_FOUND` | bad id | refresh runs |
| `RUN_IN_FLIGHT` | another run active | wait/cancel, or pass `force` explicitly |
| `COST_CONFIRMATION_REQUIRED` | paid backend without an explicit confirmation | confirm the cost or choose local |
| `DASHBOARD_UNAVAILABLE` | API requested but unreachable | switch to CLI or start the dashboard |
| `BAD_REQUEST` | invalid args | fix the call |

Every tool failure returns `{ ok: false, error: { code, message, hint } }` as a
normal result; never throw a raw stack into the transcript.

### 5.3 Tool catalog

| Tool | Args | Returns | Mutating |
| --- | --- | --- | --- |
| `orx_projects` | — | `{ projects: Project[] }` | no |
| `orx_tree` | `projectId`, `all?` | `{ project, experiments, lineage: 'full'\|'flat' }` | no |
| `orx_runs` | `projectId`, `experimentId?` | `{ runs: Run[] }` | no |
| `orx_logs` | `runId`, `tailBytes?`, `full?` | `LogSummary` (+ text when `full`) | no |
| `orx_experiment_create` | `projectId`, `title`, `parentId?`, `baseline?`, `description?`, `runCommand?` | `{ experiment }` | yes |
| `orx_experiment_run` | `experimentId`, `backend?`, `flavor?`, `timeout?`, `host?`, `force?`, `confirmCost?` | `{ started, runId? }` | yes |
| `orx_run_cancel` | `experimentId` | `{ cancelled }` | yes |
| `orx_run_wait` | `experimentId?`, `projectId?`, `timeoutSec?` | `{ status, timedOut }` | no |
| `orx_compute_status` | — | backends + default | no |
| `orx_compute_catalog` | `gpu?`, `cpu?`, `provider?` | offers | no |
| `orx_discover` | `source`, `query`, `limit?` | `{ papers: Paper[] }` | no |
| `orx_paper` | `id`, `source?`, `full?` | `{ title, authors, url, abstract, text? }` | no |
| `orx_doctor` | — | checks with pass/fail/fix | no |

Tool descriptions must end with a policy pointer, not repeat policy:

> "Read `orx-experiment-tree` before creating, editing, or running an experiment."

### 5.4 HTTP routes

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/api/openresearch/status` | — | doctor snapshot |
| GET | `/api/openresearch/projects` | — | projects |
| GET | `/api/openresearch/tree` | `project` | tree |
| GET | `/api/openresearch/runs` | `project`, `experiment?` | runs |
| GET | `/api/openresearch/logs` | `run`, `offset?`, `limit?` | log summary/chunk |
| POST | `/api/openresearch/experiments` | create args | experiment |
| POST | `/api/openresearch/runs` | run args | started |
| POST | `/api/openresearch/runs/cancel` | `experimentId` | cancelled |
| POST | `/api/openresearch/experiments/archive` | `experimentId`, `scope` | result |

Response envelope: `{ ok: true, value }` or `{ ok: false, error }`. No raw
filesystem paths outside the log path the user asked for. Validate ids with
`/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/`.

### 5.5 Config schema

| Key | Default | Purpose |
| --- | --- | --- |
| `dataSource` | `auto` | `auto \| cli \| api` |
| `dashboardPort` | `4795` | sidecar port; 4791 is reused if healthy |
| `manageDashboard` | `false` | spawn/kill a `--no-agent --no-browser` sidecar |
| `injectProjectContext` | `true` | deferred project note |
| `logTailBytes` | `65536` | default tail size |
| `requestTimeoutMs` | `15000` | CLI/API read timeout |
| `allowUnsupportedOrx` | `false` | bypass the version gate with a warning |

### 5.6 Parser fixtures

`scripts/capture-fixtures.mjs` runs the real CLI and writes sanitized fixtures:

- replace the user home and repo roots with `<home>` and `<repo>`
- keep ids and statuses
- record the `orx` version in `tests/fixtures/VERSION`
- fail if any fixture misses a required marker

Parsers reject unknown shapes instead of guessing. A fixture-driven test fails
when `tests/fixtures/VERSION` and the installed `orx` differ, prompting a
refresh; it is not a hard CI failure when `orx` is absent.

---

## 6. Tasks

Each task states files, change, verification, and compatibility. Tasks are
execution units, not commits. A phase gate is a hard stop until its evidence
exists.

| Phase | Tasks | Effort | Gate |
| --- | --- | --- | --- |
| 0 Foundations | T0.1–T0.6 | 3–5 days | parsers, version gate, API spikes |
| 1 Tools + context | T1.1–T1.9 | 8–10 days | core loop via tools, first request clean |
| 2 Read-only panel | T2.1–T2.8 | 10–15 days | tree/runs/logs visible in DSH |
| 3 Writes + supervision | T3.1–T3.6 | 7–10 days | full loop from the UI |
| 4 Compute + literature | T4.1–T4.6 | 10–15 days | compute/literature without the CLI |
| 5 Authoring + library | T5.1–T5.4 | 8–12 days | `.tex` to PDF, library usable |
| 6 Productization | T6.1–T6.5 | 5–8 days | doctor, update notice, docs |

MVP (Phases 0–2): 21–30 dev-days. Full plan: 51–75 dev-days. Critical path:
T0.6 gates Phase 2; T1.1 gates every tool task.

### Phase 0 — Foundations

#### T0.1 Baseline and workspace

- **Files:** `docs/aegis/**` (this plan), `docs/OPENRESEARCH-PARITY.md`.
- **Change:** initialize the plan workspace, record baseline versions and the
  approved Option C decision.
- **Verify:** `python "$env:USERPROFILE/.dsh/profiles/desktop/node_modules/aegis/scripts/aegis-workspace.py" check --root .`;
  `docs/aegis/INDEX.md` lists this plan.
- **Compat:** docs only.
- **Status:** complete at plan time — workspace initialized and this plan indexed.

#### T0.2 Extract the `orx` resolver

- **Files:** `src/shared/resolve-orx.mjs` (new), `scripts/sync-skills.mjs`
  (modify), `tests/unit/resolve.test.mjs` (new).
- **Change:** move the lookup order into one pure function:
  `$ORX_BIN` → `PATH` (`orx`, `orx.cmd`, `orx.exe`) → `%LOCALAPPDATA%\Programs\OpenResearch\orx.exe`
  → `~/.local/bin/orx`. Export `resolveOrx(env, platform, exists)` and
  `orxSpawnTarget(path)` (returns `{ file, argsPrefix }` for `.cmd`/`.bat`).
- **Verify:** `node --test tests/unit/resolve.test.mjs`; existing
  `sync-skills` tests stay green.
- **Compat:** the sync script's observable behavior is unchanged; this removes a
  second owner of the lookup.

#### T0.3 Spawn wrapper

- **Files:** `src/server/orx/exec.mjs` (new), `tests/unit/exec.test.mjs`.
- **Change:** `runOrx(args, { cwd, timeoutMs, signal, maxBytes })` returns
  `{ stdout, stderr, code }`. Args are always an array (no shell interpolation).
  On Windows, `.cmd`/`.bat` go through `cmd.exe /d /s /c` with a pre-quoted
  command string. Normalize CRLF, strip ANSI, cap output at 5 MB. Timeout kills
  the process tree (`taskkill /T /F` fallback on Windows).
- **Verify:** unit tests with a fake `orx` script for success, non-zero, timeout,
  oversized output; `node --check`.
- **Compat:** none (new module).

#### T0.4 Version gate

- **Files:** `src/server/orx/version.mjs`, `tests/unit/version.test.mjs`.
- **Change:** parse `orx X.Y.Z`, compare semver, cache per process,
  `assertSupported()` throws `ORX_VERSION_UNSUPPORTED` with the supported range.
- **Verify:** table tests for older/newer/prerelease strings; integration check
  against the installed binary when present.
- **Compat:** `allowUnsupportedOrx` bypasses with a warning.

#### T0.5 Fixtures and parsers

- **Files:** `tests/fixtures/{VERSION,projects.json,project-view.txt,runs.txt,exp-status.txt,logs.txt}`,
  `scripts/capture-fixtures.mjs`, `src/server/orx/parse.mjs`,
  `tests/unit/parse.test.mjs`.
- **Change:** pure parsers:
  - `parseProjectsJson`
  - `parseProjectView` (header + experiments; `parentId: null` by design)
  - `parseRunsTable` (Unicode table → rows; normalize status)
  - `parseExperimentStatus` (`parent:`, `last run:`, `branch:`, `command:`)
  - `parseLogSummary` (path, size, tail)
  - `parseVersion`
- **Verify:** `node --test tests/unit/parse.test.mjs`; malformed fixture throws
  `ORX_PARSE_FAILED`; captured fixture from the live CLI parses.
- **Compat:** parser output is internal until T1.1 freezes the types.

#### T0.6 DSH API spikes (gate for Phase 2)

- **Files:** `docs/notes/dsh-api-spikes.md` (new).
- **Questions to answer, each with a confirmed snippet or a documented fallback:**
  1. Exact route registration through the `connection` service (same mechanism
     as `/api/dsh-context/*`).
  2. Client service names and imports for `sidebarRightTabs`, `slots`,
     `commandUi`, `locale`; how the host resolves the `./client` export.
  3. Whether a DSH jobs service is callable from a plugin, and its shape.
  4. Whether the client can call same-origin `/api/openresearch/*` without extra
     CORS handling.
  5. How a tool declares approval risk or otherwise interacts with permission
     presets (`tools/pre-execute`, user approval).
  6. Whether plugin routes inherit the host's auth/CSRF protection.
  7. How to detect an existing dashboard and prove ownership of a spawned child.
- **How:** read the installed package docs/source (`app.asar`), inspect installed
  plugins (`dsh-context`, `dsh-hide-ui`), and if necessary add a temporary
  `console.log` in `apply()` and read DSH logs after a restart. Remove temporary
  probes before finishing.
- **Verify:** the note contains a working code sketch per question or marks the
  feature blocked with the fallback.
- **Gate:** Phase 2 does not start until questions 1, 2, and 5 are answered.


### Phase 1 — Tools and ambient context

#### T1.1 Shared contracts and errors

- **Files:** `src/shared/contracts.mjs`, `src/shared/errors.mjs`.
- **Change:** typedefs from §5.1, constants (`ROUTE_PREFIX`, supported range),
  `OrxError` with `code`, `message`, `hint`, `exitCode`.
- **Verify:** `node --check`; imported by parsers/tools.

#### T1.2 High-level read client

- **Files:** `src/server/orx/client.mjs`, `tests/unit/client.test.mjs`.
- **Change:** `listProjects`, `viewProject`, `listRuns`, `experimentStatus`,
  `logSummary`, `readLogChunk`. Composes exec + parse; caches projects for 30 s.
  Rejects with `OrxError`. Validate ids against
  `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`. For logs, accept only the path returned
  by `orx logs`, require a regular file under the orx run-log directory, and cap
  the read size.
- **Verify:** unit tests with a fake exec; integration against the live CLI when
  `ORX_INTEGRATION=1`.

#### T1.3 Read tools

- **Files:** `src/server/tools/read.mjs`, `tests/unit/tools-read.test.mjs`.
- **Change:** `defineTool` for `orx_projects`, `orx_tree`,
  `orx_runs`, `orx_logs` per §5.3; markdown rendering with a compact table and a
  link to open the Research tab.
- **Verify:** execute with a fake client; assert the canonical output and the
  rendered text; invalid args become normal error results.

#### T1.4 Write tools

- **Files:** `src/server/tools/write.mjs`, `tests/unit/tools-write.test.mjs`.
- **Change:** `orx_experiment_create`, `orx_experiment_run`, `orx_run_cancel`,
  `orx_run_wait`. Pass flags as discrete args; never build a command string.
  `run` returns `{ started: true }` and discovers the run id from `orx runs`
  immediately after; if not found, it says so instead of guessing. Use a 120 s
  exec timeout for submission (cloud provisioning is slow) and do not wait for
  the job. Resolve the effective backend (explicit or the `compute status`
  default); if it is billed (`hf`, `modal`, `openresearch`), reject unless
  `confirmCost: true`; the error is `COST_CONFIRMATION_REQUIRED`.
- **Verify:** fake exec asserts exact argv; a `--force` call is reachable only
  with an explicit argument; integration write tests are manual (do not create
  projects in CI).

#### T1.5 Registration wiring

- **Files:** `src/index.mjs`, `src/server/tools.mjs`.
- **Change:** keep the skill provider first; register tools only when
  `ctx.get('tools', false)` is present; log a single warning otherwise.
- **Verify:** stub-ctx test records one provider + N tools; restart DSH and
  confirm the tools appear in a session.

#### T1.6 Prompt section

- **Files:** `src/server/context.mjs`, `tests/unit/context.test.mjs`.
- **Change:** contribute one section, ~12 lines, ordered relative to
  `HARNESS_IDENTITY` (+1000). Content: fixed run contract, freeze rule, evidence
  format, "use `orx_*` tools", "read the skill before acting", "in plan mode use
  only read tools", and "delegate with DSH subagents, not `orx agent spawn`". No
  duplication of skill text.
- **Verify:** stub captures `{ name, order, text }`; manual check in the context
  tab after restart.

#### T1.7 Deferred project context

- **Files:** `src/server/context.mjs` (session part), `tests/unit/session-context.test.mjs`.
- **Change:** resolve the project by longest-prefix match of the session cwd
  against `orx projects`; inject one compact note after the first durable
  promotion signal (`tool/call` or `assistant/message`), never into the first
  request. Re-arm after compaction. Skip when no project matches or the feature
  is disabled.
- **Verify:** state-machine unit test; manual: first request has no note, the
  note appears in the next turn, and it reappears after a compaction.

#### T1.8 Doctor

- **Files:** `src/server/doctor.mjs`, `src/server/tools.mjs` (add `orx_doctor`).
- **Change:** checks: binary found, version supported, login state (only if the
  check is cheap), project count, dashboard health, Git, TeX. Each check returns
  `{ id, ok, detail, fix }`.
- **Verify:** unit with stubs for missing/broken/healthy; manual on this machine.

#### T1.9 CI and tests

- **Files:** `.github/workflows/ci.yml` (extend), `tests/unit/**`.
- **Change:** run `node --test` as today (it already discovers subdirectories).
  Add `node --check` for the client entry. Keep integration opt-in.
- **Verify:** CI locally simulated with `node --test`; no network in unit tests.

**Phase 1 gate:** tools create/run/wait/log on a real local project, first
request unchanged, doctor actionable.

### Phase 2 — Read-only Research panel

#### T2.1 Client module and tab (risk spike)

- **Files:** `package.json`, `src/client/index.js` (new).
- **Change:** add the client entry and a minimal tab type
  `openresearch.research` with a "hello" body. No data yet.
- **Verify:** restart DSH; the tab appears and renders. If it cannot render,
  stop and record the blocker; fall back to the `/orx dashboard` embed.
- **Compat:** server half still works without the client.

#### T2.2 Route facade

- **Files:** `src/server/api.mjs`, `src/server/handlers.mjs`,
  `tests/unit/handlers.test.mjs`.
- **Change:** register `/api/openresearch/status` and `/projects`; pure handlers
  for the rest. Envelope + error mapping per §5.4.
- **Verify:** `Invoke-RestMethod http://127.0.0.1:52711/api/openresearch/status`;
  handler unit tests.

#### T2.3 Data adapter

- **Files:** `src/server/dashboard.mjs`, `tests/unit/dashboard.test.mjs`.
- **Change:** `probeDashboard(port)`, `apiGet(path)`, sidecar start/stop (only
  when `manageDashboard`), `dataSource` resolution. Reuse 4791 when healthy;
  never write to the store. Own only a child this plugin spawned: never kill a
  user-started dashboard; stop the sidecar on plugin dispose.

- **Verify:** fake HTTP server tests; manual with the dashboard stopped and
  running.

#### T2.4 Client data layer

- **Files:** `src/client/panel.js`, `src/client/format.js`,
  `tests/unit/format.test.mjs`.
- **Change:** fetch wrapper with abort, 2 s visible-poll, error states; pure
  formatters for duration, relative time, status tone.
- **Verify:** formatter unit tests; manual network failure shows a retry state.

#### T2.5 Tree and project picker

- **Files:** `src/client/panel.js`.
- **Change:** project select, indented tree when `lineage: 'full'`, flat list
  with a "lineage unavailable" note when flat; status chips; select node.
- **Verify:** demo project renders 3 nodes; a 50-node project stays responsive.

#### T2.6 Runs table and log pane

- **Files:** `src/client/panel.js`.
- **Change:** runs table (id, status, commit, duration, updated), log tail with
  follow and refresh; read the log path from the server, never construct it.
  Live tail: dashboard SSE when available, `orx serve` `/event` as the second
  choice, otherwise poll the file size.
- **Verify:** the demo run's 1 MB log tail renders; follow stops when the tab is
  hidden.

#### T2.7 Slash commands

- **Files:** `src/client/index.js`.
- **Change:** one `/orx` popupSelect with options: Open panel, Tree, Runs, Logs,
  Doctor. Each opens the tab with params.
- **Verify:** manual command palette; unknown subcommand falls back to help.

#### T2.8 Empty, error, and deep-link states

- **Files:** `src/client/panel.js`, `src/client/index.js`.
- **Change:** states for no `orx`, no projects, empty tree, no runs; run rows and
  tool results carry `params` that open the tab focused on the run.
- **Verify:** manual with `ORX_BIN` pointing at a missing file; deep link focuses
  the correct run.

**Phase 2 gate:** tree, runs, and logs visible in DSH for a real project with
both data sources; `/orx dashboard` stopgap is either shipped or explicitly
dropped.

### Phase 3 — Write actions and supervision

#### T3.1 Create-child dialog

- **Files:** `src/client/panel.js`, `src/server/handlers.mjs`.
- **Change:** title (required), description, parent (default selected node),
  run command (default inherited, visually locked), baseline toggle. Submit → POST → refresh tree and focus the new node.
- **Verify:** create a child in a scratch project; branch name shown; no
  duplicate nodes.

#### T3.2 Run dialog

- **Files:** `src/client/panel.js`, `src/server/handlers.mjs`.
- **Change:** backend default from `compute status`, flavor/timeout only for
  backends that accept them, explicit `force` checkbox with a warning, cost
  warning for paid backends. Confirm before POST and send `confirmCost: true`
  only after the user confirms.
- **Verify:** local backend launch; paid backends are disabled in tests.

#### T3.3 Cancel and wait

- **Files:** `src/client/panel.js`, `src/server/tools/write.mjs`.
- **Change:** cancel button with confirmation; wait uses `orx exp wait` bounded
  by the exec timeout (the CLI has no timeout flag); UI shows "waiting" without
  blocking the chat.
- **Verify:** launch a local sleep-like run, cancel it, see `cancelled`; wait
  returns the terminal status.

#### T3.4 Job and completion mapping (optional)

- **Files:** `src/server/jobs.mjs` (only if T0.6 confirms an API).
- **Change:** mirror an active run into a DSH job for `job_output`/`job_kill`;
  otherwise use the polling notifier from T2.4.
- **Verify:** `job_list` shows the run; kill routes to `orx exp cancel`.
- **Compat:** if the jobs API is absent, no feature claims depend on it.

#### T3.5 Archive, move, notes

- **Files:** `src/client/panel.js`, `src/server/handlers.mjs`.
- **Change:** context menu: archive/unarchive (scope), reparent, edit description
  (`orx exp desc --stdin`).
- **Verify:** archive hides a node; `--all` shows it; reparent changes the tree.

#### T3.6 Reconciliation

- **Files:** `src/server/dashboard.mjs`, `src/client/panel.js`.
- **Change:** after any write, refetch from the source; on mount, never trust a
  cached terminal state; drop stale responses by request sequence.
- **Verify:** kill DSH mid-run, restart, and see the run's current state.

**Phase 3 gate:** full loop operable from DSH; no orphaned jobs; paid actions
gated by confirmation.

### Phase 4 — Compute and literature

#### T4.1 Fixture capture and parsers

- **Files:** `tests/fixtures/compute-status.txt`, `compute-catalog.txt`,
  `discover-keyword.txt`, `paper.txt`, parser additions, tests.
- **Change:** capture real outputs; parse only stable fields. If `discover`
  emits no stable structure, return raw text plus a "structured results
  unavailable" flag rather than inventing fields.
- **Verify:** fixture tests; no network in unit tests.

#### T4.2 Compute status and defaults

- **Files:** `src/server/tools/compute.mjs`, `src/server/handlers.mjs`,
  `src/client/panel.js`.
- **Change:** `orx_compute_status`; settings card rows (backend, default, test);
  `orx compute test` is an explicit user action, never automatic.
- **Verify:** status matches `orx compute status`; test a configured local
  backend.

#### T4.3 Catalog

- **Files:** compute tool + client table.
- **Change:** read-only GPU/CPU offers with provider, memory, price; filter;
  "use for next run" writes only the dialog default, not a persisted orx setting.
- **Verify:** catalog matches CLI output; no mutation.

#### T4.4 Instances

- **Files:** compute tool + client list.
- **Change:** list; create/delete behind a strong confirmation naming the price
  and org.
- **Verify:** list only in CI; manual create/delete on a cheap flavor if the user
  authorizes spend.

#### T4.5 Literature tools

- **Files:** `src/server/tools/literature.mjs`, `src/client/panel.js`.
- **Change:** `orx_discover` (source enum), `orx_paper`; render paper cards with
  title, authors, year, source, abstract, links. Open the paper URL externally,
  or download it to a user-chosen path; use DSH's preview only when a local file
  exists.
- **Verify:** a keyword query returns cards; `orx paper` opens a known paper;
  citations are markdown links.

#### T4.6 Citation helper

- **Files:** `src/shared/citations.mjs`.
- **Change:** format a paper as a stable markdown citation; no fabricated
  metadata.
- **Verify:** unit tests for missing fields (never print `undefined`).

**Phase 4 gate:** compute and literature usable without the terminal; no paid
action without confirmation.

### Phase 5 — Authoring and library

#### T5.1 LaTeX compile and preview

- **Files:** `src/server/authoring.mjs`, `src/client/panel.js`.
- **Change:** compile `.tex` via the dashboard `POST /api/projects/{id}/file/latex`
  when available; fallback to `latexmk`/`tectonic` if installed; otherwise
  return the missing-toolchain message. Show the PDF with DSH's preview.
- **Verify:** sample `.tex` compiles; missing engine produces a fix message.
- **Compat:** no claim that `orx` CLI compiles LaTeX.

#### T5.2 Templates

- **Files:** `src/server/authoring.mjs`, client.
- **Change:** list/insert local templates; discovery path confirmed by reading
  `orx` behavior (do not guess); add via file picker.
- **Verify:** insert a template into a scratch workspace.

#### T5.3 Skills library

- **Files:** same.
- **Change:** list local skills, open source, add a ZIP.
- **Verify:** add a test skill and see it listed.

#### T5.4 Overleaf (defer)

- **Change:** none unless requested. Record the decision and the auth/network
  cost.

**Phase 5 gate:** `.tex` → PDF in DSH; library surfaces usable.

### Phase 6 — Productization

#### T6.1 Doctor settings card

- **Files:** `src/client/index.js`, settings registration.
- **Change:** render the doctor checks with fix actions and a copy button.

#### T6.2 Update notice

- **Files:** `src/server/doctor.mjs`.
- **Change:** compare `orx version --check` and the manifest's `orxVersion`;
  show a dismissible notice. Never auto-update.

#### T6.3 i18n

- **Files:** `locale/en.json`, `locale/zh.json`, client strings.
- **Change:** all user-facing panel strings through `ctx.locale`; English default.

#### T6.4 Packaging and docs

- **Files:** `README.md`, `package.json`, `docs/**`.
- **Change:** document the client half, data source, doctor, and the `file:` vs
  `link:` install difference; add a quickstart and troubleshooting table.

#### T6.5 Privacy statement

- **Files:** `README.md`.
- **Change:** state that the plugin collects nothing; `orx` telemetry is
  governed by `orx telemetry`.

**Phase 6 gate:** install → doctor green → first run without reading source.

---

## 7. Verification

### 7.1 Commands

```sh
node --test
node --test tests/unit
node --check src/client/index.js
node scripts/sync-skills.mjs --check --offline
# optional, with a real orx and a scratch project:
ORX_INTEGRATION=1 node --test tests/integration
```

### 7.2 Test obligations

- Every parser has a passing fixture and a malformed-input failure test.
- Every handler maps errors to the taxonomy and never returns a stack.
- Every mutating tool is asserted at the argv level (flags as discrete args).
- Version gate has boundary tests.
- Formatters never print `undefined`/`NaN`.
- No test requires network, `orx`, or DSH.

### 7.3 Integration (opt-in)

`tests/integration/orx-smoke.test.mjs`:

1. resolve `orx`, assert version supported
2. `listProjects` returns ≥1 project
3. for the demo project, `viewProject` parses ≥1 experiment
4. `listRuns` parses a completed run
5. `logSummary` points at a readable file and its size matches
6. skip writes unless `ORX_WRITE_TEST=1` and a scratch project id is provided

### 7.4 Manual DSH checklist (run at each phase gate)

- [ ] Restart DSH; no plugin load error; skills still list 16 entries.
- [ ] Tools appear and are callable; one call returns structured output.
- [ ] First model request contains no project note; the note appears later.
- [ ] Research tab opens; tree renders; selecting a node shows runs.
- [ ] Log pane shows the real tail and follows.
- [ ] Create/run/cancel from the UI behaves and refreshes.
- [ ] Missing `orx` (bad `ORX_BIN`) yields doctor guidance, not a crash.
- [ ] Remove the client bundle entry; server half still loads.

### 7.5 CI

- Keep the existing matrix (Ubuntu/Windows × Node 22/24).
- Unit tests must pass without `orx`.
- Add a Windows-only resolver/exec test job step (already covered by unit tests).
- Client smoke: `node --check` and, if a headless harness is added later, a
  Playwright check; do not block the plan on a browser harness.

---

## 8. Risks

| Risk | L | I | Mitigation |
| --- | --- | --- | --- |
| DSH route registration differs from the docs | Med | High | T0.6 spike; fallback to `/orx dashboard` embed; Phase 2 gated |
| Client tab service names/imports differ | Med | High | T0.6 + T2.1 minimal spike; server half independent |
| `orx` text output drifts | High | High | fixtures + version gate + explicit `ORX_PARSE_FAILED`; optional upstream `--json` |
| Dashboard `/api/*` is internal and changes | Med | Med | adapter behind `dataSource`; never a hard dependency |
| Paid compute launched by mistake | Low | High | confirm dialog with price/org; no paid paths in tests; `force` explicit |
| Approval fatigue | Med | Med | read-only default; one confirmation per mutation |
| N+1 `exp status` calls on large trees | Med | Med | API adapter first; cap nodes; lazy child expansion |
| Path traversal via log path | Low | High | only read the path returned by `orx logs`; validate it exists and is a file; cap size |
| Client bundle breaks on a DSH update | Med | Med | peer range + `dsh.compatibility`; client half optional |
| Windows `.cmd` spawn | Med | Med | reuse the sync script's tested path in T0.2/T0.3 |
| Scope creep into a full harness | Med | High | §1.2 non-goals enforced at every phase gate |

L = likelihood, I = impact.

---

## 9. Retirement

| Path | Retire when | How |
| --- | --- | --- |
| `/orx dashboard` embed stopgap | Phase 2 ships and works | remove the command and docs entry |
| CLI text parsers | upstream `--json` lands and is adopted | switch the adapter, delete parsers and fixtures |
| Dashboard API adapter | DSH or `orx` exposes a stable public API | remove behind the same `dataSource` seam |
| Manual project matching | DSH provides project identity | remove the prefix matcher |

No legacy owner is retained: `orx` remains the only writer, and the plugin has no
fallback store.

---

## 10. Execution handoff

| Field | Value |
| --- | --- |
| Decision | **inline** |
| Evidence | Shared files (`package.json`, `src/index.mjs`, contracts) and sequential phase gates; coordination cost exceeds parallel benefit for Phases 0–3 |
| Subagent use | Allowed after Phase 1 for genuinely independent Phase 4 adapters (compute vs literature) with disjoint files |
| Fallback | inline |
| User confirmation required | **no** — planning only; paid compute, account/login actions, or an upstream PR need separate confirmation at execution time |

Execution order: T0.2 → T0.3 → T0.4 → T0.5 → T0.6 → T1.1 → T1.2 → T1.3/T1.4 → T1.5 → T1.6/T1.7 → T1.8 → gate → T2.1 → T2.2 → … Do not start Phase 2 before
T0.6 resolves the route and client questions.

---

## 11. Self-review

| Check | Result |
| --- | --- |
| Approved scope covered | Yes: tools, panel, writes, compute, literature, authoring, productization |
| Acceptance maps to tasks | Yes: §1.3 ↔ phase gates; parity report §10 |
| No placeholders | Unknowns are explicit spike tasks with fallbacks, not TBD steps |
| Owners and types consistent | `orx` single writer; types in `contracts.mjs`; errors in `errors.mjs` |
| Minimum change boundary | Server/tools/client only; skills and bundle patch unchanged |
| Compatibility | DSH/orx ranges, optional services, client-optional |
| Verification exact | Commands and manual checklist are runnable |
| Retirement | Stopgap and parsers have triggers |
| Risk | Top risk (DSH route) gated before the expensive phase |

---

## Appendix A — Observed `orx` outputs (sanitized, 0.2.19)

`orx projects --json`:

```json
[{"baselineBranch":"main","id":"<project-id>","name":"<name>","paperId":null,"path":"<repo>"}]
```

`orx project view <id>`:

```text
<name> (local)
  id:      <project-id>
  repo:    <repo>
  branch:  main (baseline)
  command: <run-command-or-em-dash>

Experiments
  <exp-id>  <title> [root]  (orx/<slug>)
```

`orx runs <id>`:

```text
ID                    STATUS  EXPERIMENT                             COMMIT   DURATION  UPDATED
────────────────────  ──────  ─────────────────────────────────────  ───────  ────────  ───────
<run-id>              done    <title>                                <sha>    3h44m     12d ago
```

`orx exp status <id>`:

```text
<title>  (idle)  [local]
  id:       <exp-id>
  branch:   orx/<slug>
  parent:   — (root experiment)
  command:  <run-command>
  last run: <run-id> (done, commit <sha>, ran 3h44m, updated 12d ago)
  commit:   <sha>
```

`orx logs <run-id>`:

```text
This is the path to the full log file: <log-path>
It is <bytes> bytes.

Here are the last 500 characters of the log file:
<tail>
```

Dashboard API (temporary probe, internal): `/api/projects/{id}/experiments`
returns `parentExperimentId`, `branchName`, `description`, `runCommand`,
`agentStatus`, `archived`, which the CLI does **not** expose as a tree.

## Appendix B — DSH references used

- `@deepseek-ai/dsh-tools` — `defineTool`, `ctx.tools.register`, `tools/pre-execute`
- `@deepseek-ai/dsh-system-prompt` — prompt sections and ordering
- `@deepseek-ai/dsh-client-ui-sidebar-right` — tab types, slots, `ctx.sidebarRight`
- `@deepseek-ai/dsh-client-ui-commands` — `ctx.commandUi` contributions
- `@deepseek-ai/dsh-client-ui-conversation` — conversation tabs (not used in v1)
- `@deepseek-ai/dsh-client-ui-deliverables` — artifact presentation (reuse)
- `@deepseek-ai/dsh-skill-filesystem` — current provider (unchanged)
- installed-plugin examples: `dsh-context` (routes, tabs, prompt), `dsh-hide-ui`
  (client module contract)
