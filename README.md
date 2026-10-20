# dsh-openresearch

A **DeepSeek Harness method pack** that brings the [OpenResearch](https://github.com/alphaXiv/OpenResearch)
(`orx`) research workflow into DSH sessions: the experiment-tree discipline, the
literature-review loop, compute routing, evidence handling, and paper drafting.

This is a *method pack*, not a reimplementation. It mounts OpenResearch's own
agent skills into DSH's skill catalog and relies on the `orx` CLI for every
action. That keeps one owner per concern:

| Concern | Owner |
| --- | --- |
| Skill instructions | The installed `orx` binary (`orx skill`, `orx skill <name>`) |
| Lazily loaded module resources (`compute/hf`, …) | `orx skill <module>/<resource>` at runtime |
| Project state, experiment tree, runs, logs | `orx` (local SQLite + Git) |
| DSH conventions the `orx` skills assume | `skills-src/openresearch-dsh` (authored here) |
| Discovery, catalog, session injection | DeepSeek Harness |

Nothing is re-implemented in TypeScript, so an `orx` upgrade upgrades the
instructions too — `skills/MANIFEST.json` records the exact version that
generated them, plus a content hash per skill.

## Why one skill is hand-written

OpenResearch injects a *session playbook* into its own agent sessions. Several of
its skills refer to that playbook for four things it never states in the skill
files: the artifacts directory, the evidence-citation contract, the Python
policy, and the dashboard location. Run verbatim inside DSH, those references
dangle — an agent told to "follow the session playbook's evidence contract" has
nothing to follow, and `<file path="…" />` tags render as literal text.

So the pack ships one authored skill, `openresearch-dsh`, that supplies exactly
those referents in DSH terms. It is the only file in `skills/` a human edits; its
source lives in `skills-src/` and `sync-skills.mjs` copies it in on every build.
Generated and authored skills never collide — a duplicate name fails the build.

## What you get

16 skills in the session catalog, routed by their own descriptions:

- `openresearch-dsh` — the DSH playbook: artifacts path, evidence links, Python policy
- `openresearch-cli` — the entry point: cardinal rules + command quick-reference
- `orx-experiment-tree` — the hypothesis tree, frozen nodes, fixed run contract, the auto-research loop
- `orx-lit-review` — alphaXiv / OpenAlex / bioRxiv / PubMed retrieval and paper evidence
- `orx-compute`, `orx-instances` — local, SSH, Slurm, Kubernetes, Modal, Ray, HF Jobs, Tinker
- `orx-create`, `orx-git`, `orx-logs`, `orx-results`, `orx-reports`, `orx-figures`, `orx-paper`
- `orx-agent-delegation`, `orx-customize`, `orx-feedback`

Because they are ordinary DSH skills, the model loads them when their
descriptions match — the same mechanism as any other skill provider.

## Prerequisites

1. **DeepSeek Harness**, with its profile at `~/.dsh/profiles/desktop`. Bundle
   installs also need **Node 22.19+ or 24+** and **pnpm** available to that
   profile.
2. **OpenResearch installed**, so `orx` exists. Either install the desktop app or
   the CLI (`curl -LsSf https://openresearch.sh/install.sh | sh` on macOS/Linux).
3. **`orx` resolvable from a shell.** Every skill invokes the bare `orx` command.
   The installer in this repository (Methods B and C) creates shims in
   `~/.local/bin` when `orx` is not already on `PATH`. Installing from GitHub
   (Method A) runs no post-install step, so those users must provide `orx`
   themselves — the desktop app's *Settings → Updates →* "Install the `orx`
   command" is the simplest route. If `~/.local/bin` exists but is not on `PATH`,
   add the OpenResearch install directory yourself.

   On Windows it writes **two** files: `orx.cmd` for cmd.exe and PowerShell (which
   resolve through `PATHEXT`) and an extensionless `orx` POSIX script for bash
   (which only runs an exact name, and would otherwise report
   `orx: command not found` in Git Bash). Re-running the install repairs a
   half-written set.

Check the whole picture at any time:

```sh
node scripts/install.mjs --status
```

## Install

### Method A: Native DSH Bundle from GitHub (Recommended for DSH Users)

Install straight from GitHub into your DeepSeek Harness profile, the same way
**Aegis** or **whale-girl** are installed:

1. In your DSH profile at `~/.dsh/profiles/desktop/package.json`, add
   `dsh-openresearch` to `dependencies` and to `dsh.profile.bundles`:

    ```json
    {
      "dependencies": {
        "dsh-openresearch": "github:lvk04/dsh-openresearch"
      },
      "dsh": {
        "profile": {
          "bundles": [
            "@deepseek-ai/dsh-base",
            "@deepseek-ai/dsh-web-app",
            "dsh-openresearch"
          ]
        }
      }
    }
    ```

    The snippet shows only the additions — keep the entries already in your
    `bundles` list.

2. Install into the profile:

    ```sh
    cd ~/.dsh/profiles/desktop
    pnpm install
    ```

    A GitHub install runs no post-install step, so `orx` must already be on
    `PATH` (prerequisite 3).

3. Restart DeepSeek Harness. `cordis.patch.yml` registers an isolated skill
   provider rooted at the package's own `skills/` directory, so nothing is copied
   into `~/.dsh/skills` and the two modes cannot overlap. Isolation cuts both
   ways: those 16 skills come *only* from this package, and they disappear again
   if you drop the bundle entry.

   A GitHub install is a snapshot: pnpm fetches a copy, so editing your checkout
   does not reach the running app. Method C links instead.

---

### Method B: Live Deploy (Local / Zero-Restart)

If you have cloned the repo locally and want the skills immediately without restarting DeepSeek Harness:

```sh
node scripts/install.mjs --mode live
```

Copies `skills/` into `<dshHome>/skills`. DSH's default filesystem provider
watches that root, so skills reach the next model step **without restarting the
app**. A receipt at `<dshHome>/skills/.openresearch-live.json` records what this
package deployed.

---

### Method C: Local Bundle Mode

If working from a local checkout and wanting to wire it into the profile as a local file dependency:

```sh
node scripts/install.mjs --mode bundle
```

Adds `dsh-openresearch` as a local dependency in the profile's `package.json` and
runs `pnpm install`. Restart DeepSeek Harness to activate.

The spec is a relative `file:` path, or `link:` when the profile and the checkout
sit on different drives — never `file:` followed by an absolute path, which pnpm
10 resolves against the profile directory on Windows and dies on with `ENOENT`
(`<profile>\D:\...`). Expect a link on Windows, where the profile lives on `C:`
and code usually does not: the profile then sees the working tree rather than a
snapshot, so a rebuilt `skills/` reaches it on the next restart without a
reinstall.

Set `PNPM_BIN` if `pnpm` is not on `PATH`. The install runs `pnpm` through the shell deliberately: Node cannot spawn a `.cmd` directly on Windows, and `cmd.exe` also avoids the PowerShell execution policies that block the `pnpm.ps1` shim.

Bundle mode is exercised end to end, not merely wired. The tests install this
package into a throwaway profile and assert `--verify` reports it active,
including that the package's own `skills/` tree lands in the profile's
`node_modules`. The in-app mount has also been confirmed on Windows 11: after the
restart, `--verify` reports `exactly one install mode is active — bundle`, and
the provider serves skill text from `node_modules/dsh-openresearch/skills/`
rather than from `~/.dsh/skills`.

## Update

```sh
node scripts/sync-skills.mjs     # regenerate skills/ from the installed orx
node scripts/install.mjs --mode live   # or --mode bundle, whichever you use
```

`sync-skills.mjs` reads the module index from `orx skill`, regenerates one
`SKILL.md` per module, copies `skills-src/` in, refreshes `skills/MANIFEST.json`,
and deletes modules that `orx` no longer ships — so the catalog can never
advertise a removed command. It fails loudly on missing frontmatter, a
non-kebab-case name, or an authored skill whose name collides with a generated
module: those are the three things that would otherwise degrade silently.

Two checks, with different guarantees:

```sh
node scripts/sync-skills.mjs --check            # freshness: needs the orx binary
node scripts/sync-skills.mjs --check --offline  # integrity: needs nothing
```

`--check` regenerates from the installed CLI and compares, so it catches a build
left behind by an `orx` upgrade. `--check --offline` verifies the committed tree
against `skills/MANIFEST.json` — frontmatter, skill set, and a sha256 per skill —
so it also runs on a machine with no `orx` at all. That is the gate CI runs.

## Verify an installation

`--status` is a snapshot; `--verify` is a doctor that exits non-zero on failure:

```sh
node scripts/install.mjs --verify              # structural checks
node scripts/install.mjs --verify --network    # adds a live alphaXiv call
```

Seven checks: the skills build is complete and matches `MANIFEST.json`; every
skill has valid DSH frontmatter; exactly one install mode is active; in bundle
mode the profile declares the dependency and the package is really installed in
its `node_modules`; and `orx` is both resolvable and runnable. `--network` adds
an eighth, a live alphaXiv retrieval, which catches a working install pointed at
a broken network path. In live mode the deployed copies must also still match
`skills/`. Each failure names the fix.

`--status` also reports **drift**: live mode deploys copies, so after an `orx`
upgrade the deployed skills go stale silently. Status and verify both compare
byte-for-byte and print the number of changed, missing, and stale skills.

## Tests

```sh
node --test
```

38 tests: frontmatter and module-index parsing, the authored/generated merge, the
offline integrity gate, installer guards (mutual exclusion, refusing to overwrite
a foreign skill directory, idempotency, dry-run leaving no trace), the dependency
spec's portability, receipt-driven uninstall, drift detection, the bundle adapter
against a stubbed host package (provider options, plus the missing-skills branch),
and the figure cropper against a generated PDF fixture — including the regression
where a full-width caption made a naive text-gap search pick the wrong region.

Two of those encode the ways CI and a developer machine differ, because both
were found by the first CI run rather than by the suite: `--help` must work
without `uv` installed, and the freshness check must skip — loudly — where the
`orx` CLI is absent instead of failing or passing vacuously.

## Uninstall

```sh
node scripts/install.mjs --uninstall          # shows the plan
node scripts/install.mjs --uninstall --yes    # applies it
```

Removes only directories this package deployed (verified to sit under the skills
root and to contain a `SKILL.md`), unwires the bundle entry and dependency if
present, and runs `pnpm install` so the profile's installed copy is pruned. It
does not remove the CLI shims in `~/.local/bin` (`orx` and, on Windows,
`orx.cmd`); delete them if you want `orx` off `PATH`.

## Platforms

This pack was developed and verified on **Windows 11**, across PowerShell,
`cmd.exe`, and Git Bash:

| Concern | Windows handling |
| --- | --- |
| `orx` lookup | `orx.cmd` + extensionless `orx`; a `%LOCALAPPDATA%\Programs\OpenResearch\orx.exe` fallback when it is not on `PATH` |
| Batch spawning | `.cmd` shims run through the shell as one pre-quoted string, because Node refuses to spawn a batch file directly |
| Figure cropping | `uv` + `pymupdf`; output paths containing spaces are quoted |
| Line endings | `.gitattributes` forces LF so a CRLF checkout cannot look like stale skills |

Executed end to end on Windows: live mode, bundle mode including the in-app
mount, the installer (install, status, verify, uninstall), the skill builder both
online and offline, and the figure cropper.

macOS and Linux are supported by design — a POSIX `~/.local/bin` shim, no
`PATHEXT`, `uv` for Python — and CI runs the suite on Ubuntu as well as Windows
at Node 22 and 24, with `pnpm` and `uv` installed so the bundle and cropper tests
run for real there rather than skipping. The POSIX paths are covered by CI but
have not been exercised interactively.

## Literature research on alphaXiv

The retrieval capabilities are OpenResearch's own primitives, exposed as ordinary
commands the agent runs — no wrapper, no extra service:

```sh
orx discover keyword "<exact terms>"     # alphaXiv full-text BM25, with page snippets
orx discover embedding "<semantic ask>"  # alphaXiv semantic title/abstract search
orx discover openalex "<query>"          # cross-disciplinary scholarly graph
orx discover biorxiv "<query>"           # biology preprints
orx discover pubmed "<query>"            # biomedical / clinical
orx paper <id>                            # alphaXiv report, or metadata+abstract elsewhere
orx paper <id> --full                     # original extracted full text
```

No login is required for any of these. Add `--published-after 2024-01-01`,
`--published-before`, `--prioritize recency|historical|popular`, or `--limit N`
to control the date window and ranking.

### Figures from the original PDF

OpenResearch's evidence rules require *original* figures, not redrawn results.
DSH can do the same because the crop helper renders the real PDF at high DPI:

```sh
node scripts/paper-figure.mjs --arxiv 2610.07659 --list
node scripts/paper-figure.mjs --arxiv 2610.07659 --figure 2 --out artifacts/dloop/figures/fig2.png
node scripts/paper-figure.mjs --pdf C:\path\paper.pdf --page 6 --out artifacts/dloop/figures/page6.png
node scripts/paper-figure.mjs --pdf C:\path\paper.pdf --page 6 --box 40,80,380,300 --out artifacts/dloop/figures/crop.png
```

Write under `artifacts/`, not a temp or `paper/` directory: that is where
`openresearch-dsh` puts deliverables the user is expected to open later. Scratch
work — downloads, discarded crops — belongs in `.scratch/`.

It prints JSON with the output path, page, pixel size, and the caption found, so
the agent can embed the image in chat with correct attribution:

```markdown
![Looped vs standard speculative decoding](artifacts/dloop/figures/fig2.png "Figure 2. ...")
```

Why a helper instead of an inline script: figure geometry is fiddly on
two-column pages, where a full-width caption touches every text block, so a
naive gap search fails. The helper clusters the page's drawing and image
geometry and picks the cluster nearest the caption, which works for single-column
and full-width layouts alike. It needs `pymupdf` + `Pillow`, supplied through
`uv run --isolated --no-project --with ...` so nothing is installed into DSH's
bundled Python. If `uv` is absent the command fails with an install hint instead
of a stack trace.

## Usage

Ask for research work and the routing takes over:

> Review the literature on equivariant graph networks and set up a baseline experiment.

The agent loads `orx-lit-review` for retrieval, then `orx-create` /
`orx-experiment-tree` to seed a project and branch the first hypotheses. The
cardinal rules it follows come from the pack:

1. Never edit a node once a run has answered it — branch a child instead.
2. The run command and environment are a fixed contract across every node.
3. Vary code/config, never knobs-in-the-command or environment variables.
4. Grow the tree downward (small fan, then descend onto the winner).

The visual experiment-tree dashboard is OpenResearch's own: `orx up` serves it at
`http://127.0.0.1:4791`.

## Limitations

- **No embedded GUI panel.** This pack gives the agent the workflow, not the DSH
  sidebar. A visual experiment tree inside DSH needs a companion bridge plugin
  that mounts a UI view; this pack deliberately does not.
- **`orx` is required at runtime.** Without it the skills still load but their
  commands fail.
- **The DSH playbook is an interpretation.** `openresearch-dsh` reconstructs what
  OpenResearch's injected session prompt provides, in DSH terms. It is not
  produced by the OpenResearch maintainers, and a future `orx` release could add
  or change a playbook expectation this pack does not yet cover.
- **Update notices on stderr.** A pending `orx` self-update prints a warning to
  stderr on each invocation; `sync-skills.mjs` already ignores stderr.
- **Windows CLI coverage.** OpenResearch's Windows support is beta; remote
  compute backends are exercised from macOS/Linux most heavily.

## Layout

```
package.json            # dsh.bundle.patch + script entry points
cordis.patch.yml        # bundle mode: isolated provider over skills/
src/index.mjs           # bundle-mode adapter (@deepseek-ai/dsh-skill-filesystem)
skills-src/             # AUTHORED skills — the only skills a human edits
  openresearch-dsh/     #   the DSH playbook the orx-* skills assume
skills/                 # BUILD OUTPUT — do not hand-edit
  MANIFEST.json         #   orx version, module index, authored list, sha256 per skill
scripts/sync-skills.mjs # build skills/ from `orx skill` + skills-src/, and check it
scripts/install.mjs     # live/bundle install, status, verify, uninstall
scripts/paper-figure.mjs # crop a figure from a paper PDF (wraps uv + pymupdf)
scripts/paper-figure.py  #   the cropper; art-cluster geometry anchored on the caption
tests/                  # node --test suite
.github/workflows/ci.yml # integrity gate + opt-in orx freshness gate
```

`skills/` is a build output. To change a generated skill, upgrade `orx`; to change
the DSH playbook, edit `skills-src/openresearch-dsh/SKILL.md` and run
`node scripts/sync-skills.mjs`. Hand-editing `skills/` directly is overwritten by
the next build and fails the integrity check.

## License

MIT for this pack (see [LICENSE](LICENSE)). The generated skill text is
OpenResearch's; see
[alphaXiv/OpenResearch](https://github.com/alphaXiv/OpenResearch) for its license.
