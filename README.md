# dsh-openresearch

A **DeepSeek Harness plugin** that mounts [OpenResearch](https://github.com/alphaXiv/OpenResearch)
(`orx`) into DSH's skill catalog: the experiment-tree discipline, the
literature-review loop, compute routing, evidence handling, and paper drafting.

It is a plugin, not a reimplementation. It serves OpenResearch's own agent skills
and relies on the `orx` CLI for every action, so one owner holds each concern:

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

## What the plugin is

Three files, plus the skills they serve:

```
package.json        dsh.bundle.patch points at cordis.patch.yml
cordis.patch.yml    inserts this bundle into the profile
src/index.mjs       registers one isolated skill provider over skills/
skills/             16 skills (generated; MANIFEST.json pins orx version + hashes)
```

At startup DSH composes the patch and calls the adapter. The adapter registers a
skill provider whose root is the package's own `skills/`, with
`includeDefaultRoots: false`: those 16 skills come only from this package, and
they disappear again if the bundle entry is removed.

There is no installer, no daemon, no wrapper around `orx`. Installing a DSH
plugin means editing the profile's `package.json` and running `pnpm install`.

## Why one skill is hand-written

OpenResearch injects a *session playbook* into its own agent sessions. Several of
its skills refer to that playbook for four things it never states in the skill
files: the artifacts directory, the evidence-citation contract, the Python
policy, and the dashboard location. Run verbatim inside DSH, those references
dangle — an agent told to "follow the session playbook's evidence contract" has
nothing to follow, and `<file path="…" />` tags render as literal text.

So the pack ships one authored skill, `openresearch-dsh`, that supplies exactly
those referents in DSH terms. It is the only skill a human edits; its source
lives in `skills-src/` and `sync-skills.mjs` copies it into `skills/` on every
build. Generated and authored skills never collide — a duplicate name fails the
build.

## What you get

16 skills in the session catalog, routed by their own descriptions:

- `openresearch-dsh` — the DSH playbook: artifacts path, evidence links, Python policy
- `openresearch-cli` — the entry point: cardinal rules + command quick-reference
- `orx-experiment-tree` — the hypothesis tree, frozen nodes, fixed run contract
- `orx-lit-review` — alphaXiv / OpenAlex / bioRxiv / PubMed retrieval and paper evidence
- `orx-compute`, `orx-instances` — local, SSH, Slurm, Kubernetes, Modal, Ray, HF Jobs, Tinker
- `orx-create`, `orx-git`, `orx-logs`, `orx-results`, `orx-reports`, `orx-figures`, `orx-paper`
- `orx-agent-delegation`, `orx-customize`, `orx-feedback`

Because they are ordinary DSH skills, the model loads them when their
descriptions match — the same mechanism as any other skill provider.

## Install

**Prerequisites**

1. **DeepSeek Harness**, profile at `~/.dsh/profiles/desktop`.
2. **`orx` on `PATH`.** Install the OpenResearch desktop app, or the CLI
   (`curl -LsSf https://openresearch.sh/install.sh | sh` on macOS/Linux). The
   desktop app can install the command for you: *Settings → Updates →* "Install
   the `orx` command". Every skill shells out to the bare `orx`; a plugin install
   runs no post-install step, so this is yours to provide.
3. **Node 22.19+ or 24+ and pnpm**, for the profile.

**From GitHub**

Add the dependency and the bundle entry to `~/.dsh/profiles/desktop/package.json`,
keeping whatever is already in your `bundles` list:

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

Then install and restart:

```sh
cd ~/.dsh/profiles/desktop
pnpm install
```

DSH composes bundles at process start, so the skills appear after a restart. A
GitHub install is a snapshot: editing a checkout does not affect it.

**From a local checkout**

Use a link rather than a path:

```json
"dsh-openresearch": "link:D:/path/to/dsh-openresearch"
```

Two reasons. `file:` followed by an absolute path is not portable — pnpm 10
resolves it against the profile directory on Windows and dies with `ENOENT` on
`<profile>\D:\...`. And a link means a rebuilt `skills/` reaches the app on the
next restart without reinstalling.

## Update the skills

`skills/` is generated from the installed `orx`, so an `orx` upgrade is the usual
reason to rebuild:

```sh
node scripts/sync-skills.mjs     # regenerate skills/ from the installed orx
```

It reads the module index from `orx skill`, regenerates one `SKILL.md` per
module, copies `skills-src/` in, refreshes `skills/MANIFEST.json`, and deletes
modules that `orx` no longer ships — so the catalog can never advertise a removed
command. It fails loudly on missing frontmatter, a non-kebab-case name, or an
authored skill whose name collides with a generated module.

Two checks, with different guarantees:

```sh
node scripts/sync-skills.mjs --check            # freshness: needs the orx binary
node scripts/sync-skills.mjs --check --offline  # integrity: needs nothing
```

`--check` regenerates from the installed CLI and compares, so it catches a build
left behind by an `orx` upgrade. `--check --offline` verifies the committed tree
against `skills/MANIFEST.json` — frontmatter, skill set, and a sha256 per skill —
so it runs on a machine with no `orx` at all. That is the gate CI runs.

## Remove

Delete `dsh-openresearch` from `dependencies` and from `dsh.profile.bundles`,
run `pnpm install`, and restart. The provider is isolated, so nothing is left
behind in `~/.dsh/skills`; `orx` itself is untouched.

## Tests

```sh
node --test
```

17 tests: the manifest and frontmatter parsing, the module-index parser, the
authored/generated merge, the offline integrity gate (including a tampered tree),
the freshness check's behaviour when `orx` is absent, and the bundle adapter
against a stubbed host package — which provider it registers, with which options,
and that a missing `skills/` tree refuses to register rather than serving an
empty catalog.

## Platforms

Developed and verified on **Windows 11**; CI runs the suite on Ubuntu and Windows
at Node 22 and 24. The Windows quirks the build tool has to know about:

| Concern | Handling |
| --- | --- |
| `orx` lookup | `$ORX_BIN`, then `PATH` (`orx.cmd`), then `%LOCALAPPDATA%\Programs\OpenResearch\orx.exe` |
| Batch spawning | `.cmd` shims run through the shell as one pre-quoted string, because Node refuses to spawn a batch file directly |
| Line endings | `.gitattributes` forces LF so a CRLF checkout cannot look like stale skills |

The bundle mount itself has been confirmed on Windows 11: after a restart the
provider serves skill text from `node_modules/dsh-openresearch/skills/` rather
than from `~/.dsh/skills`. macOS and Linux are supported by design — no
`PATHEXT`, no `.cmd` — and are covered by CI, but have not been exercised
interactively.

## Limitations

- **No embedded GUI panel.** This is a skill provider, not a UI. A visual
  experiment tree inside DSH needs a companion plugin that mounts a view.
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
package.json             # dsh.bundle.patch + script entry points
cordis.patch.yml         # bundle: inserts this package
src/index.mjs            # adapter: isolated provider over skills/
skills-src/              # AUTHORED skills — the only skills a human edits
  openresearch-dsh/      #   the DSH playbook the orx-* skills assume
skills/                  # BUILD OUTPUT — do not hand-edit
  MANIFEST.json          #   orx version, module index, authored list, sha256 per skill
scripts/sync-skills.mjs  # build skills/ from `orx skill` + skills-src/, and check it
tests/                   # node --test suite
.github/workflows/ci.yml # integrity gate + opt-in orx freshness gate
```

To change a generated skill, upgrade `orx` and rebuild; to change the DSH
playbook, edit `skills-src/openresearch-dsh/SKILL.md` and rebuild. Hand-editing
`skills/` directly is overwritten by the next build and fails the integrity
check.

## License

MIT for this pack (see [LICENSE](LICENSE)). The generated skill text is
OpenResearch's; see
[alphaXiv/OpenResearch](https://github.com/alphaXiv/OpenResearch) for its license.
