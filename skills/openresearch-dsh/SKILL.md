---
name: openresearch-dsh
description: "DeepSeek Harness conventions for OpenResearch work: where the artifacts directory is, how to cite runs and files as clickable evidence in DSH chat, which Python to use, and where the OpenResearch dashboard lives. Read before the orx-* skills when a task produces files, figures, or measured results."
---

# OpenResearch on DeepSeek Harness

The `orx-*` skills are OpenResearch's own instructions, written for OpenResearch's
in-app agent sessions. DSH runs them from a normal terminal session, so a few
things they refer to do not exist here until this page defines them.

Read this once, then load the specific `orx-*` skill for the task.

## The "session playbook" is this page

Several `orx-*` skills say "follow the session playbook's …". In OpenResearch that
is a system prompt injected at launch. **In DSH, this page is that playbook.** It
carries the four facts those skills assume: the artifacts directory, the evidence
contract, the Python policy, and the dashboard location.

## Artifacts directory

OpenResearch agents get a per-project artifacts directory. Here it is:

```
<session working directory>/artifacts/
```

Create it on first use. The `artifacts/` prefix is workspace-relative, so the
paths the `orx-reports` and `orx-figures` skills show — `artifacts/<topic>/…` —
resolve correctly as ordinary DSH workspace paths. Do not invent a second
location, and do not write deliverables to a temp directory: the user opens these
files from the chat, so they must outlive the session.

Scratch work (PDF downloads, intermediate crops, trial plots that will not be
cited) belongs outside `artifacts/`, for example `<workspace>/.scratch/`.

## Evidence contract (this replaces OpenResearch's raw tags)

OpenResearch's playbook asks its agent to emit raw tags such as
`<file path="…" />` and `<run id="…" />`. Those render as **literal text** in
DSH — they are not links and not clickable. Emit DSH's own forms instead:

| Claim | OpenResearch tag | Emit in DSH |
| --- | --- | --- |
| A code or file fact | `<file path="src/model.py" />` | `` `src/model.py` `` or a markdown link `[src/model.py](src/model.py)` |
| The same file at specific lines | `<file path="src/model.py" lines="20-40" />` | `[src/model.py:20-40](src/model.py)` |
| A measured run result | `<run id="run_123" />` | a markdown link to the log, `[run_123](artifacts/…)`, plus the numbers inline |
| A committed file on an experiment branch | `<file path="src/model.py" exp="exp_9" />` | name the branch in prose: "on `orx/exp-9`, `src/model.py` …" |
| An artifact | `<file path="artifacts/r/figure.svg" />` | `[figure.svg](artifacts/r/figure.svg)` |

Two rules survive unchanged from OpenResearch, because they are about evidence
rather than rendering:

1. **Name what you read.** A run's status is not evidence; read its log before
   reporting its result.
2. **Label inference.** If you did not observe it, say so instead of presenting a
   guess as an observation.

When a claim rests on a paper rather than this repository, cite the paper as
`orx-lit-review` instructs — those citations are already DSH-compatible.

## Figures

Images render in DSH chat when embedded as markdown. When a claim rests on a
figure in a paper, show the original: crop it out of the PDF, never redraw a
result. Save it under `artifacts/<topic>/figures/`, with the script that produced
the crop next to it, and follow the Python policy below so the crop is
reproducible without touching the harness interpreter.

Then embed it once with a caption in the title, and keep a separate link:

```markdown
![What the figure shows](artifacts/<topic>/figures/fig2.png "Figure 2. Why it matters. [p. 3](https://www.alphaxiv.org/pdf/<id>?page=3)")
```

Do not embed the same underlying image twice in a conversation; reuse the link.

Figures that `orx-figures` asks you to build with matplotlib or TikZ go beside
their report under `artifacts/<topic>/figures/`, with the generating script kept
next to the output.

## Python policy

The `orx-figures` and `orx-paper` skills say "follow the session playbook's Python
policy". It is this:

- **Prefer `uv`** when it is available (`uv --version`). For a one-off dependency
  use `uv run --isolated --no-project --with <package> python -…` so nothing is
  installed into a shared interpreter.
- **Do not `pip install` into DSH's bundled Python.** It is part of the app and an
  update replaces it. Use `uv`, a project virtualenv, or an existing environment.
- **Respect the project's own tooling.** `pyproject.toml` alone does not prove the
  project uses `uv`; inspect for `uv.lock` or existing instructions first. Use
  `uv run --locked` in uv projects and commit lockfile changes with the code.
- **Never share a virtualenv between experiment worktrees.** Each node gets its
  own environment; dependencies travel through Git, not through a copied `.venv`.
- A run's command must recreate its dependencies from committed files. The
  environment is part of the "fixed run contract", so a run that only works
  because of a hand-made environment is not reproducible.

## Dashboard, and where run output lives

- The visual experiment tree, run logs, and metrics are OpenResearch's own
  dashboard. Start it with `orx up`; it serves `http://127.0.0.1:4791`.
- The agent does not need the dashboard to work: `orx project view <projectId>`,
  `orx runs <projectId>`, and `orx logs <runId>` read the same local store from
  the terminal, and are what to use when driving a loop.
- Run output is a file on disk. `orx logs <runId>` reports its path and a preview;
  read the file for the actual measurements.

## Prerequisites this pack assumes

- `orx` is installed and resolvable from a shell as `orx`. If a command reports
  that `orx` is missing, the pack was installed without the CLI on `PATH`.
- Every `orx` subcommand that mutates state needs the project to exist already
  (`orx projects`). Do not invent project or experiment ids.
