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
| Discovery, catalog, session injection | DeepSeek Harness |

Nothing is re-implemented in TypeScript, so an `orx` upgrade upgrades the
instructions too — `skills/MANIFEST.json` records the exact version that
generated them.

## What you get

15 skills in the session catalog, routed by their own descriptions:

- `openresearch-cli` — the entry point: cardinal rules + command quick-reference
- `orx-experiment-tree` — the hypothesis tree, frozen nodes, fixed run contract, the auto-research loop
- `orx-lit-review` — alphaXiv / OpenAlex / bioRxiv / PubMed retrieval and paper evidence
- `orx-compute`, `orx-instances` — local, SSH, Slurm, Kubernetes, Modal, Ray, HF Jobs, Tinker
- `orx-create`, `orx-git`, `orx-logs`, `orx-results`, `orx-reports`, `orx-figures`, `orx-paper`
- `orx-agent-delegation`, `orx-customize`, `orx-feedback`

Because they are ordinary DSH skills, the model loads them when their
descriptions match — the same mechanism as any other skill provider.

## Prerequisites

1. **OpenResearch installed**, so `orx` exists. Either install the desktop app or
   the CLI (`curl -LsSf https://openresearch.sh/install.sh | sh` on macOS/Linux).
2. **`orx` resolvable from a shell.** Every skill invokes the bare `orx` command.
   The installer creates a shim in `~/.local/bin` when `orx` is not already on
   `PATH`; if that directory is not on `PATH` either, add the OpenResearch install
   directory yourself.

Check the whole picture at any time:

```sh
node scripts/install.mjs --status
```

## Install

### Method A: Native DSH Bundle from GitHub (Recommended for DSH Users)

Other users can install `dsh-openresearch` directly from GitHub into their DeepSeek Harness profile, exactly like **Aegis** or **whale-girl**:

1. In their DSH profile `~/.dsh/profiles/desktop/package.json`, add `dsh-openresearch` to `dependencies` and `dsh.profile.bundles`:

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

2. Run `pnpm install` in the profile directory:
```sh
cd ~/.dsh/profiles/desktop
pnpm install
```

3. Restart DeepSeek Harness. The skills are automatically loaded by the isolated bundle provider without copying files.

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

Adds `dsh-openresearch` as a local `file:` dependency in the profile's `package.json` and runs `pnpm install`. Restart DeepSeek Harness to activate.

## Update

```sh
node scripts/sync-skills.mjs     # regenerate skills/ from the installed orx
node scripts/install.mjs --mode live   # or --mode bundle, whichever you use
```

`sync-skills.mjs` reads the module index from `orx skill`, regenerates one
`SKILL.md` per module, refreshes `skills/MANIFEST.json`, and deletes modules that
`orx` no longer ships — so the catalog can never advertise a removed command.
It fails loudly on missing frontmatter or a non-kebab-case name, which are the
two things DSH silently drops a skill for.

CI-style drift check:

```sh
node scripts/sync-skills.mjs --check   # exits 1 when skills/ is stale
```

## Uninstall

```sh
node scripts/install.mjs --uninstall          # shows the plan
node scripts/install.mjs --uninstall --yes    # applies it
```

Removes only directories this package deployed (verified to sit under the skills
root and to contain a `SKILL.md`) and unwires the bundle entry if present. It
does not remove the `~/.local/bin/orx.cmd` shim; delete that file if you want
`orx` off `PATH`.

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
node scripts/paper-figure.mjs --arxiv 2610.07659 --figure 2 --out paper/figure2.png
node scripts/paper-figure.mjs --pdf C:\path\paper.pdf --page 6 --out paper/page6.png
node scripts/paper-figure.mjs --pdf C:\path\paper.pdf --page 6 --box 40,80,380,300 --out crop.png
```

It prints JSON with the output path, page, pixel size, and the caption found, so
the agent can embed the image in chat with correct attribution:

```markdown
![Looped vs standard speculative decoding](paper/figure2.png "Figure 2. ...")
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
  sidebar. A visual tree inside DSH needs the bridge-plugin route (Option 1), not
  this one.
- **`orx` is required at runtime.** Without it the skills still load but their
  commands fail.
- **Update notices on stderr.** A pending `orx` self-update prints a warning to
  stderr on each invocation; `sync-skills.mjs` already ignores stderr.
- **Windows CLI coverage.** OpenResearch's Windows support is beta; remote
  compute backends are exercised from macOS/Linux most heavily.

## Layout

```
package.json           # dsh.bundle.patch + script entry points
cordis.patch.yml       # bundle mode: isolated provider over skills/
src/index.mjs          # bundle-mode adapter (@deepseek-ai/dsh-skill-filesystem)
skills/                # generated from the installed orx binary — do not hand-edit
  MANIFEST.json        #   orx version + module index
scripts/sync-skills.mjs # regenerate skills/ from `orx skill`
scripts/install.mjs     # live/bundle install, status, uninstall
scripts/paper-figure.mjs # crop a figure from a paper PDF (wraps uv + pymupdf)
scripts/paper-figure.py  #   the cropper; art-cluster geometry anchored on the caption
```

`skills/` is generated. Edit `scripts/sync-skills.mjs` or upgrade `orx` instead —
hand edits are overwritten by the next sync and masked by the drift check.

## License

MIT for this pack. The generated skill text is OpenResearch's; see
[alphaXiv/OpenResearch](https://github.com/alphaXiv/OpenResearch) for its license.
