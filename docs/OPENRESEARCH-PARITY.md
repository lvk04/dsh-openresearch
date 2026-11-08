# OpenResearch parity: gap analysis and development plan

**Status:** proposal, not implemented
**Baseline:** `dsh-openresearch` 0.1.0 at `22cc31c`; `orx` 0.2.19 (matches the latest upstream release, 2026-10-15); DeepSeek Harness desktop 0.2.1-rc.2
**Compared against:** [alphaXiv/OpenResearch](https://github.com/alphaXiv/OpenResearch) `main` (992 files, 98 directories, MIT)

---

## 0. TL;DR

This repository is a **complete agent-side integration and a zero workspace-side integration**.

- On the agent side it is at parity: all 14 upstream `orx` skills, the CLI overview, and one authored DSH playbook, pinned to the exact `orx` version that produced them. The model is told how to run OpenResearch correctly.
- On the workspace side it is absent: there are no typed tools, no ambient session context, no experiment-tree view, no run/log view, no write actions, no compute or literature UI. The human has to leave DSH and open `http://127.0.0.1:4791` (or read terminal output) to see what the agent did.

The shortest honest summary: **the skills teach the agent; nothing gives the user a research workspace.**

Recommended direction: do **not** clone the OpenResearch desktop app inside DSH. DSH already owns the agent harness, chat, terminal, files, jobs, subagents, deliverables, settings, and plugin management. Build the missing **research layer** on top of `orx`:

1. typed tools over `orx` (so the model stops hand-building shell commands),
2. a read-only research panel in DSH (tree, runs, logs),
3. write orchestration with approval and job supervision,
4. compute and literature surfaces,
5. productization (doctor, update notices, i18n, packaging).

Rough sizing: **Phases 0–2 (~4–6 weeks solo) deliver the daily-driver experience**; all phases (~10–15 weeks solo) approach feature parity for the research loop.

---

## 1. What each side is

### OpenResearch

A local-first **research harness and workspace**:

| Layer | What it owns |
| --- | --- |
| Engine | `orx` (Rust, ~45 MB): local SQLite store, Git repositories and per-experiment branches, run supervision, compute orchestration |
| Agent runtime | OpenCode-based agent plus ACP harness adapters (Claude Code, Codex, Cursor, Antigravity); model selection; local models (LM Studio, oMLX, Ollama); plan/invocation/MCP gates; autonomy levels |
| Workspace UI | An embedded SPA served by `orx up` on `127.0.0.1:4791`: project home, chat, experiment tree/lineage, runs table, log terminal, code editor and diffs, artifacts, skills, subagents, settings, onboarding tour |
| Authoring | LaTeX compile and PDF preview, Overleaf sync, templates, publication figure guidance |
| Literature | alphaXiv/OpenAlex/bioRxiv/PubMed retrieval, paper fetch, citation-shaped evidence |
| Compute | Local, SSH, Slurm, Kubernetes, Modal, Ray, Hugging Face Jobs, Tinker, managed OpenResearch compute; GPU/CPU catalog; instance provisioning |
| Platform | Installers for macOS/Windows/Linux, auto-update, opt-out telemetry, 5 locales, remote dashboard over SSH |

### This plugin

A **DeepSeek Harness bundle** that mounts OpenResearch's own agent skills:

```
package.json        dsh.bundle.patch -> cordis.patch.yml
cordis.patch.yml    inserts the bundle into the DSH profile
src/index.mjs       ~40 lines: registers one isolated skill provider over skills/
skills/             16 generated/authored skills + MANIFEST.json (orx version + sha256)
skills-src/         the one authored skill (openresearch-dsh)
scripts/            sync-skills.mjs (generate + two integrity checks)
tests/              17 node:test cases
```

It deliberately adds no runtime authority: no tools, no prompt injection, no state, no UI. `orx` remains the only implementation of every research action.

---

## 2. What is already at parity

| Capability | Evidence | Status |
| --- | --- | --- |
| Upstream skill set | 14/14 `agent-skills` modules match, names and descriptions | Full |
| CLI overview | generated `openresearch-cli` skill (upstream prints this dynamically) | Full |
| DSH playbook | authored `openresearch-dsh`: artifacts path, evidence links, Python policy, dashboard location | Full |
| Version pinning | `skills/MANIFEST.json` records `orxVersion: 0.2.19` and a sha256 per skill | Full |
| Drift detection | `--check` (needs `orx`) and `--check --offline` (integrity only) | Full |
| Test coverage of the build | 17 passing tests, including a tampered-tree rejection | Full |
| Agent behavior guidance | experiment-tree discipline, fixed run contract, freeze rule, evidence rules, figure/paper rules | Full |
| Every `orx` action reachable | through the shell, guided by the skills | Full (via shell) |

Two useful checks made while writing this document:

- `orx --version` reports `0.2.19`; `orx version --check` reports *up to date*; the packaged skills match the installed CLI (the freshness test passes).
- The local store is real, not a fixture: 6+ projects, a demo project with 3 experiment nodes, a completed run and a 1 MB log.

So the claim "skills are at parity" is verifiable today. The rest of this document is about everything else.

---

## 3. Parity scorecard

Legend: **Full** = usable parity for the job; **Partial** = the engine exists but DSH does not surface it; **None** = absent.

| Area | OpenResearch | This plugin | Status |
| --- | --- | --- | --- |
| Agent skill instructions | 14 skills + injected session playbook | 14 + overview + DSH playbook | **Full** |
| Native agent tools | built-in toolset + gates | none (skill text + shell) | **None** |
| Session context injection | playbook, autonomy, project/experiment context every turn | on-demand skill only | **None** |
| Project registry | dashboard + API | `orx projects` (JSON available) | **Partial** |
| Experiment tree (data) | SQLite + dashboard API | `orx project view` text; `exp status` has a parent, not a tree | **Partial** |
| Experiment tree (UI) | `TreeView`, `ExperimentLineage`, hover cards | none | **None** |
| Runs table | `ExperimentsTable`, filters | none | **None** |
| Log viewer | `LogTerminal`, live tail | none (`orx logs` preview) | **None** |
| Artifacts | `ArtifactsTab`, artifact links | DSH deliverables/files only | **Partial** |
| Code / diff per branch | editor, `GitDiff`, worktree tabs | DSH file tools; no branch diff view | **Partial** |
| Experiment notes | description editing in UI | `orx exp desc` only | **Partial** |
| Run comparison / metrics | cross-run views | prose via `orx-results` | **None** |
| Evidence cards (run/file/paper) | raw tags rendered by the app | DSH markdown links | **Partial** |
| Create experiment | UI form | CLI via skill | **Partial** |
| Launch / cancel / wait / wake | UI + supervised runs | CLI via skill | **Partial** |
| Concurrency / run safety | in-flight guard, `--force` | skill text only | **Partial** |
| Compute status / config | settings UI | CLI only | **None** |
| GPU/CPU catalog | catalog UI | CLI only | **None** |
| Instances | spin up / list / delete | CLI only | **None** |
| Account / orgs / SSH keys / login | settings UI | CLI only | **None** |
| Remote dashboard over SSH | `orx up --remote` | none | **None** |
| Literature search | connectors + picker + cards | CLI via skill | **Partial** |
| Paper fetch / PDF reading | PDF preview, paper cards | CLI via skill | **Partial** |
| LaTeX compile / preview | `useLatexCompile`, `PdfPreview` | skill writes `.tex`; no compile | **None** |
| Overleaf sync | live sync panel | none | **None** |
| Skills / templates library | `SkillsTab`, add flow | `orx skills add` via skill | **Partial** |
| Onboarding / tour | `Onboarding`, `Tour` | none | **None** |
| Doctor / install / update | installers, `UpdateBanner` | manual profile edit; manifest pin | **None** |
| i18n | en/es/ko/zh/ja | English only | **None** |
| Telemetry / privacy | opt-out analytics + feedback | none | **None** |
| Packaging | signed app per OS | npm/GitHub package | **None** |

---

## 4. Gap inventory

Priority: **P0** blocks the core research loop in DSH, **P1** needed for daily use, **P2** parity, **P3** polish.

### 4.1 Agent layer

| ID | Gap | Why it matters | Priority |
| --- | --- | --- | --- |
| G1 | No model-facing tools for `orx` | The model must load a skill, remember CLI syntax, build shell strings, and parse Unicode tables. Errors are shell errors, not structured results. | P0 |
| G2 | No ambient session context | OpenResearch injects the playbook and project/experiment context every turn. In DSH the skill must be discovered each time, and the freeze rule can be missed after a compaction. | P0 |
| G3 | No autonomy level | OpenResearch's copilot/agentic switch rides every turn as `<orx-autonomy>`. DSH has permission presets, but no research-specific posture. | P2 |
| G4 | No harness gates | OpenResearch's plan gate allows read-only `orx` inspection in plan mode; the invocation gate stamps `ORX_INVOCATION_CONTEXT`; a separate MCP gate exists for tool-server access. DSH has `tools/pre-execute` but nothing research-aware. | P2 |
| G5 | No delegation bridge | `orx agent spawn` creates an OpenResearch chat outside DSH, bypassing DSH subagents/workflows. The skill describes it, which can surprise the user with a second agent surface. | P2 |
| G6 | No session/run linkage | OpenResearch links an experiment to its chat session (`chatSessionId`). DSH sessions have no project/experiment identity. | P2 |

### 4.2 Research objects and UI

| ID | Gap | Why it matters | Priority |
| --- | --- | --- | --- |
| G7 | No project picker | Users must run `orx projects` and copy UUIDs. | P1 |
| G8 | No experiment tree view | The central object of the method is invisible in DSH. Current skill playbook tells the user to open `orx up` in a browser — i.e. leave DSH. | P0 |
| G9 | No runs table | Status, duration, backend, commit, and exit state are only in CLI text. | P0 |
| G10 | No log viewer | `orx logs` prints path/size/tail; reading a 1 MB log means leaving the chat. | P0 |
| G11 | No artifact browser | `artifacts/` is a convention, not a first-class object; DSH deliverables only cover presented files. | P1 |
| G12 | No branch diff view | Comparing a child's committed code with its parent is manual `git diff`. | P1 |
| G13 | No notes editing | `orx exp desc` is CLI-only; descriptions are the experiment's memory. | P2 |
| G14 | No cross-run comparison | `orx-results` is prose; there is no table/chart of comparable metrics. | P2 |
| G15 | No evidence cards | Run/file/paper citations are plain markdown links; OpenResearch renders typed tags. | P1 |

### 4.3 Workflow and orchestration

| ID | Gap | Why it matters | Priority |
| --- | --- | --- | --- |
| G16 | No create-experiment action | Every branch starts with a CLI command and copy-pasted UUIDs. | P1 |
| G17 | No run/cancel/wait actions | Launching requires knowing backend flags; cancel and wait are separate commands. | P1 |
| G18 | No job supervision mapping | DSH jobs exist but `orx exp run` returns immediately; nothing tracks the run to completion or notifies. | P1 |
| G19 | No in-flight guard in tooling | `--force` semantics live only in the skill text. | P2 |
| G20 | No archive/move/reparent | Tree maintenance is CLI-only. | P3 |
| G21 | No worktree/session coordination | Multi-agent work on one project is described, not surfaced. | P3 |

### 4.4 Compute

| ID | Gap | Why it matters | Priority |
| --- | --- | --- | --- |
| G22 | No compute status/config UI | `orx compute status/show/configure/test` is a CLI surface with many backends. | P2 |
| G23 | No catalog | GPU/CPU offers, prices, providers are browsable only in the terminal. | P2 |
| G24 | No instance management | Spin up/list/delete is CLI-only. | P2 |
| G25 | No account/orgs/SSH surface | Login, org selection, SSH keys are prerequisites for managed compute. | P2 |
| G26 | No remote dashboard | `orx up --remote` is not reachable from DSH. | P3 |

### 4.5 Literature and authoring

| ID | Gap | Why it matters | Priority |
| --- | --- | --- | --- |
| G27 | No literature tool/cards | `orx discover`/`orx paper` are CLI text; no structured results or citation cards in chat. | P2 |
| G28 | No PDF reading surface | DSH can preview files, but paper fetch and page-level evidence are manual. | P2 |
| G29 | No LaTeX compile | `orx-paper` writes `.tex`; no compile/PDF step in DSH. | P2 |
| G30 | No Overleaf sync | Live sync is a differentiator for paper work. | P3 |
| G31 | No templates library UI | `orx templates add` is CLI-only. | P3 |

### 4.6 Platform

| ID | Gap | Why it matters | Priority |
| --- | --- | --- | --- |
| G32 | No doctor / orx detection | If `orx` is missing, skills load and commands fail. No actionable diagnosis. | P1 |
| G33 | No update awareness | `orx version --check` exists, but DSH never shows it; the manifest pin can silently age. | P2 |
| G34 | No i18n | OpenResearch ships 5 locales; this pack is English-only. | P3 |
| G35 | No telemetry/privacy statement | OpenResearch is explicit about opt-out analytics. The plugin collects nothing; that should be stated. | P3 |
| G36 | No packaging/installer | Install is "edit the profile and `pnpm install`"; the README itself warns about `file:` on Windows. | P2 |

---

## 5. Strategy: three options

### Option A — Clone the desktop app in DSH

Port the Rust engine and the React workspace into a DSH plugin. Rejected: it duplicates DSH's chat, sessions, terminal, files, model routing, and plugin management; it forks a 992-file Rust project; and it abandons the one-writer design that keeps this repo honest.

### Option B — Thin bridge only (tools, no UI)

Wrap `orx` in typed tools and inject context. Cheap (~2 weeks), removes G1/G2, but the user still cannot see the tree or a run without a browser. It makes the agent better and leaves the human where they are.

### Option C — Research layer on DSH (recommended)

Keep `orx` as the system of record and the executor. Add a **server half** (typed tools, routes, ambient context, guards, compute/literature adapters) and a **client half** (a research panel, run/log views, actions, settings). DSH supplies everything else.

**Non-goals** (explicitly out of scope):

- agent runtime, chat, model picker, terminal, file tree, subagents, MCP, sessions
- writing to the `orx` SQLite store, or mirroring it
- reimplementing compute backends, paper retrieval, or the experiment engine
- a standalone desktop app, telemetry backend, or account system

---

## 6. Target architecture

```
┌──────────────────────────── DSH ────────────────────────────┐
│  client plugin (web)                                        │
│    Research panel  ── tree · runs · log tail · actions      │
│    Slash commands  ── /orx tree | runs | logs | doctor      │
│    Settings card   ── data source, compute defaults         │
│            │  fetch /api/openresearch/*   (SSE optional)    │
│  server plugin                                              │
│    tools        ── orx_projects, orx_tree, orx_experiment_* │
│    context      ── prompt section + deferred session notes  │
│    guards       ── pre-execute validation, in-flight check  │
│    adapters     ── CLI (exec) · serve API · dashboard API   │
└───────────────────────────┬─────────────────────────────────┘
                            │  read-only / command invocation
┌───────────────────────────▼─────────────────────────────────┐
│  orx 0.2.x  (system of record: SQLite + Git + run logs)     │
│    CLI · orx serve (loopback run API) · orx up (/api + SSE) │
└─────────────────────────────────────────────────────────────┘
```

### 6.1 Data access decision

| Source | Data | Stability | Role |
| --- | --- | --- | --- |
| `orx projects --json` | project list | stable, documented by usage | primary |
| `orx project view`, `orx runs`, `orx exp status` | tree, runs, status | human-oriented text | primary, behind strict parsers |
| `orx logs <run>` | log path + size + tail | stable text | primary |
| `orx serve` `/runs`, `/runs/{id}/logs`, `/event` | runs + log stream | documented loopback API | live log tailing |
| `orx up` `/api/*` + `/api/events` | full tree (`parentExperimentId`), runs, files, diff, compute | **internal, undocumented** | optional rich adapter |
| SQLite directly | everything | **internal schema** | never |

Rules:

1. **One writer.** `orx` is the only writer. The plugin reads and invokes; it never opens the store for writing.
2. **CLI first.** Mutations and identity go through the CLI. Rich reads may use the dashboard API behind a version-gated adapter.
3. **Version gate.** At startup, parse `orx --version`; if the major/minor is outside the tested range, degrade to CLI text and warn once.
4. **No dashboard requirement.** The agent loop must work with the CLI alone. The API adapter is an enhancement, and if `orx up` is already running on 4791 the plugin reuses it; otherwise it may start a managed `orx up --no-agent --no-browser` sidecar on a plugin-owned port.
5. **Upstream the JSON.** The durable fix for parsing is an upstream `orx --json` for `project view`, `runs`, and `exp status`. It is a small Rust change in a MIT project, benefits both products, and removes the most fragile part of this plan.

### 6.2 Server plugin surfaces (verified DSH APIs)

- Tools: `ctx.tools.register(defineTool({ name, description, parameters, output, execute }))`; errors become normal tool results; `tools/pre-execute` can deny with a reason.
- Prompt: `ctx.systemPrompt.section({ name, order, text })`; keep the research section short and load-bearing, not a copy of the skills.
- Session context: create a plugin-authored user message at a durable lifecycle boundary (the Aegis pattern defers injection until the first promotion signal so the anchored first request stays clean).
- Routes: register `/api/openresearch/*` on the connection service, as `dsh-context` does for `/api/dsh-context/*`.
- Settings: a per-user configuration card under the plugin's page.

### 6.3 Client plugin surfaces

- `package.json` gains `dsh.client` (`platform: "web"`, `inject: [...]`) and a `./client` export; today the package has no client half at all.
- A right-sidebar tab type (`ctx.sidebarRightTabs.register` + `ctx.slots.register`) for **Research**, with a guide entry so it is discoverable.
- Slash commands through `ctx.commandUi` (popupSelect or action).
- Reuse `@deepseek-ai/dsh-client-ui-primitives`, theme tokens, and the locale service; do not invent a second design system.
- Run citations can open the panel tab with `ctx.sidebarRight.openTab(kind, { params })`, so a tool result can carry a clickable run reference.

### 6.4 Proposed first tool set

| Tool | Mode | Returns |
| --- | --- | --- |
| `orx_projects` | read | project list (id, name, path, baseline branch) |
| `orx_tree` | read | project + nodes (id, title, parent, branch, status, archived, description) |
| `orx_runs` | read | runs for a project/experiment (id, status, commit, duration, updated) |
| `orx_logs` | read | log path, size, tail bytes; optional full read |
| `orx_experiment_create` | write | new experiment id + branch |
| `orx_experiment_run` | write | run id + backend |
| `orx_run_cancel` | write | cancellation result |
| `orx_run_wait` | read | terminal status after wait/timeout |
| `orx_compute` | read | backend status, catalog, defaults |
| `orx_discover` | read | structured papers (title, id, abstract, url, score) |
| `orx_paper` | read | paper metadata + full-text link/report |

Tools are mechanics; policy stays in the skills. Each description should end with "read `orx-experiment-tree` before changing the tree" rather than restating the rules.

---

## 7. Development plan

Estimates are solo dev-days including tests. Each phase is shippable on its own.

### Phase 0 — Contracts and data path (3–5 days)

- Probe every parser against real output: `projects --json`, `project view`, `runs`, `exp status`, `logs`, `compute status --json`, `orx serve` routes, dashboard `/api/*`.
- Write the version gate and the `orx` executable resolver (reuse the sync script's Windows handling: `$ORX_BIN`, `PATH`, `%LOCALAPPDATA%\\Programs\\OpenResearch\\orx.exe`).
- Record fixtures from a real store; table-driven parser tests.
- Decision record: CLI-first + optional API; never SQLite.
- Optional upstream PR: `--json` for `project view`, `runs`, `exp status`.

**Done when:** a Node module returns typed project/tree/run/log objects from this machine with zero shell-string construction, and fails loudly on version drift.

### Phase 1 — Typed tools and ambient context (8–10 days)

- Implement the tool set in 6.4, with `defineTool`, structured output, and markdown rendering.
- Add the research prompt section: the fixed run contract, the freeze rule, evidence-link format, and "load the skill before acting".
- Add deferred session context: detect the project from the working directory (`orx projects --json` + path match), inject a compact `<openresearch project=... experiment=... />` note after the first turn boundary.
- Add guards: mutating tools refuse without a resolvable project/node; run refuses when a run is in flight unless `force`; all failures return an actionable message ("run `orx doctor`").
- Add `/orx doctor` (server-side command) for the first week: binary, version, login, projects, store, TeX presence.

**Done when:** an agent can create a child, edit code, launch a run, wait, and read its log using only tools — no shell, no UUID copying — and the first request to the model is unchanged.

### Phase 2 — Read-only research panel (10–15 days)

- Add `dsh.client` and the client bundle; register the **Research** tab type and guide entry.
- Layout: project picker → tree (indented by `parentExperimentId`, status chips) → runs table → log pane with follow/tail.
- Data route `/api/openresearch/tree`, `.../runs`, `.../logs`; poll while visible, or subscribe to `/api/events` through the API adapter.
- Deep link: run rows and citations open the tab with `params`; `/orx tree`, `/orx runs`, `/orx logs` slash commands.
- Empty states for: no `orx`, no project, empty tree, no runs.
- **Cheap fallback to validate demand first:** a `/orx dashboard` command that ensures `orx up --no-agent` is running and opens `http://127.0.0.1:4791` in the system browser (or DSH's browser sidebar, which ships as `dsh-client-ui-sidebar-browser`). One day of work; it tells you whether users need a native panel at all.

**Done when:** a user watches a run go from queued to running to done, and reads its log, without leaving DSH.

### Phase 3 — Write actions and supervision (7–10 days)

- Create-child dialog (title, description, parent, run command) with a diff-free preview of the inherited contract.
- Run action with a compute picker (default backend + flavor) and a confirmation; cancel action with the same confirmation.
- Map a launched run to DSH jobs so `job_output`/`job_kill` and completion notices work; do not build a second supervisor.
- Optimistic UI with reconciliation from the store; never cache a run's terminal state.
- Archive/move in a context menu; notes editing in a drawer.

**Done when:** the full loop (create → edit → run → wait → read → promote) is operable from DSH, with no orphaned runs after a DSH restart.

### Phase 4 — Compute and literature (10–15 days)

- Settings card: backend status, default, `test` action, credential hints, login state, org list, SSH keys.
- Catalog table: GPU/CPU offers, provider, price, availability; filter; "use for run" writes only the next launch's choice.
- Instance list: create/list/delete with cost confirmation and teardown guidance.
- Literature tools `orx_discover`/`orx_paper`, with paper cards (title, authors, year, source, abstract, links) and a PDF open action.
- A citation helper that formats the sources the skill expects.

**Done when:** a user can choose compute and launch, and can ask a literature question and get cited, clickable results in chat.

### Phase 5 — Authoring and library (8–12 days)

- LaTeX: detect `.tex`, compile through the available engine (`latexmk`/`tectonic`), show PDF in DSH's preview; when no engine exists, say exactly what to install. Do not claim `orx` can compile — its LaTeX path is internal to the dashboard.
- Templates: browse and insert from the local library; add via file picker.
- Skills library: list local skills, open the source, add a skill ZIP.
- Overleaf sync: only if a user asks; it needs auth and a network proxy, and is the least local-first feature here.

**Done when:** a `.tex` under the workspace renders to a PDF inside DSH, and a template can be inserted without touching the terminal.

### Phase 6 — Productization (5–8 days)

- Doctor surfaces in Settings: binary, version vs latest (`orx version --check`), login, Git, TeX, dashboard reachability.
- Update notice when the manifest's `orxVersion` is older than the installed CLI or the latest release.
- i18n (at least en + zh, matching DSH's locale service), plus a privacy note: the plugin sends nothing.
- Packaging: GitHub/npm install path that works on Windows; document `link:` vs the profile's current `file:` usage (the README warns that `file:` with an absolute path is not portable).
- Docs: screenshots, a 5-minute quickstart, a troubleshooting table.

**Done when:** a new user installs the plugin, sees a green doctor, and runs the demo project without reading the source.

---

## 8. Effort and sequencing

| Phase | Deliverable | Days | Depends on | Risk |
| --- | --- | --- | --- | --- |
| 0 | typed `orx` client + fixtures + ADR | 3–5 | — | Low |
| 1 | tools + prompt section + deferred context + guards | 8–10 | 0 | Medium: parser fragility |
| 2 | Research panel (read-only) + slash commands | 10–15 | 0, 1 | Medium: DSH client APIs |
| 3 | write actions + job mapping | 7–10 | 1, 2 | Medium: approvals/UX |
| 4 | compute + literature | 10–15 | 1 | Low–medium |
| 5 | LaTeX + library | 8–12 | 1 | Medium: toolchain |
| 6 | doctor, update, i18n, packaging | 5–8 | 1–3 | Low |

**MVP (0–2):** 21–30 dev-days. **Full (0–6):** 51–75 dev-days.

Sequence note: Phase 1 is the highest value per day; Phase 2 is the highest *visible* value. Do not start Phase 4/5 before 1–2 are in daily use — compute and literature are CLI-complete already, and the panel is what changes the experience.

---

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| `orx` CLI output is human-formatted; parsers break on a release | Fixtures + strict parsers + version gate; upstream `--json` PR; degrade to raw text with a visible warning |
| Dashboard `/api/*` is internal and changes | Treat as optional adapter; never a hard dependency; pin a tested `orx` range |
| Schema coupling if SQLite is read directly | Do not read SQLite; `orx serve` and the CLI are the contract |
| Two sources of truth (DSH cache vs store) | No mirror; read-through on focus/refresh; reconcile after writes |
| Approval fatigue on mutating tools | Read-only by default; one confirmation per run; batch actions explicit |
| Windows-first plugin vs beta Windows `orx` | CI matrix; test the resolver paths; document the supported range |
| Client plugin API churn in DSH | Pin peer versions, declare `dsh.compatibility`, and keep the client half optional (skills still work without it) |
| Bundle changes need a restart | Document it; use the plugin manager; live-skill install remains an escape hatch |
| Scope creep into cloning DSH | The non-goals in §5 are a contract; review every feature against "does DSH already own this?" |

---

## 10. Definition of done (parity)

1. The core loop works with tools only: project → tree → create child → edit → run → wait → logs → next decision.
2. The user can see tree, runs, and logs inside DSH without opening a browser.
3. A run can be created, cancelled, and inspected from the UI, with the same guardrails the skills describe.
4. Compute can be selected and launched from DSH; failures explain the fix, not a stack trace.
5. Literature queries return structured, citable results; papers open in DSH.
6. `artifacts/` is a first-class deliverable surface (presented, linked, and listed per experiment).
7. A missing or outdated `orx` produces a doctor card with an actionable fix, not a silent failure.
8. The plugin remains a single-writer, local-first client: no telemetry, no store writes, no duplicate agent runtime.

Metrics worth tracking after Phase 2: parser failure rate (target <1% of calls), tool error rate, time from "new project" to "first run", and the share of tree/run/log interactions that happen in DSH rather than the dashboard.

---

## 11. The next two weeks

If only two weeks are available, do exactly this:

1. **Days 1–3:** Phase 0. Real fixtures, version gate, resolver, and the `--json` upstream PR if time allows.
2. **Days 4–8:** Phase 1 tools for the loop: `orx_projects`, `orx_tree`, `orx_experiment_create`, `orx_experiment_run`, `orx_runs`, `orx_logs`.
3. **Days 9–10:** prompt section + deferred project context + `/orx doctor`.
4. **Days 11–12:** `/orx dashboard` (embed the existing dashboard) as the stopgap for G8–G10.
5. **Days 13–14:** measure. If the embedded dashboard is enough, skip most of Phase 2; if users keep asking for in-chat status, build the panel.

That sequence buys most of the agent-side value in one sprint and answers the expensive question (native panel or embedded dashboard) with evidence rather than assumption.

---

## Appendix A — Evidence collected

Commands and probes used for this report, all read-only:

- `orx --help`, and `--help` for `project`, `exp`, `runs`, `logs`, `create-experiment`, `compute`, `instance`, `serve`, `up`, `discover`, `paper`, `skills`, `templates`, `install-skills`, `orgs`, `ssh-key`
- `orx projects --json`, `orx project view demo_nanochat_v1`, `orx runs demo_nanochat_v1`, `orx exp status demo_nanochat_cpu_v1`, `orx logs demo_nanochat_run_v1`, `orx version --check`
- a temporary `orx up --no-agent --no-browser --port 4793` to read `/api/projects/{id}` and `/api/projects/{id}/experiments` (stopped afterwards)
- upstream `README.md`, `LICENSE`, `Cargo.toml`, `agent-skills/`, `src/commands/{up,serve,plan_gate,invocation_gate}.rs`, `src/local/{autonomy,harness}`, `ui/src/{components,routes}`
- DSH package docs extracted read-only from the installed `app.asar`: `dsh-tools`, `dsh-client-ui-conversation`, `dsh-client-ui-sidebar-right`, `dsh-client-ui-commands`, `dsh-system-prompt`, `dsh-client-ui-deliverables`, `dsh-skill-filesystem`

## Appendix B — Local environment

| Fact | Value |
| --- | --- |
| DSH desktop | 0.2.1-rc.2 (Node 24.21, pnpm 11.28.5) |
| `orx` | 0.2.19 at `%LOCALAPPDATA%\\Programs\\OpenResearch\\orx.exe`; `orx version --check` reports up to date |
| Profile | `~/.dsh/profiles/desktop`, bundle listed as `dsh-openresearch` |
| Store | 6+ projects; demo project with 3 nodes and a completed run |
| Plugin tests | 17/17 pass; offline integrity check passes |
