#!/usr/bin/env node
/**
 * Crop an original figure out of a paper PDF, using pymupdf supplied by `uv`.
 *
 * The OpenResearch literature workflow demands figures taken from the real PDF
 * rather than redrawn results, so this is a deterministic one-command path
 * instead of an ad-hoc script per paper. pymupdf is not installed into the
 * harness runtime on purpose: `uv run --isolated --no-project` keeps the
 * dependency out of DSH's bundled Python and caches it after the first use.
 *
 * Usage:
 *   node scripts/paper-figure.mjs --arxiv 2610.07659 --list
 *   node scripts/paper-figure.mjs --arxiv 2610.07659 --figure 1 --out artifacts/<topic>/figures/fig1.png
 *   node scripts/paper-figure.mjs --pdf C:\path\to.pdf --page 6 --out artifacts/<topic>/figures/page6.png
 *   node scripts/paper-figure.mjs --pdf C:\path\to.pdf --page 6 --box 40,80,380,300 --out artifacts/<topic>/figures/crop.png
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'paper-figure.py')

/** Locate `uv`: explicit env, then PATH. */
function findUv() {
  const explicit = process.env.UV_BIN
  if (explicit && existsSync(explicit)) return explicit
  const names = process.platform === 'win32' ? ['uv.exe', 'uv.cmd', 'uv'] : ['uv']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

// Help comes before the uv lookup on purpose: asking what a tool does must not
// require the tool's dependency to be installed.
const args = process.argv.slice(2)
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(
    [
      'Usage:',
      '  node scripts/paper-figure.mjs --arxiv <id> --list',
      '  node scripts/paper-figure.mjs --arxiv <id> --figure <n> --out <png> [--dpi 200]',
      '  node scripts/paper-figure.mjs --pdf <path> --page <n> --out <png>',
      '  node scripts/paper-figure.mjs --pdf <path> --page <n> --box x0,y0,x1,y1 --out <png>',
      '',
      'Needs `uv` on PATH (or UV_BIN); pymupdf and Pillow are supplied through',
      '`uv run --isolated` and never installed into the harness Python.',
    ].join('\n'),
  )
  process.exit(0)
}

const uv = findUv()
if (!uv) {
  console.error(
    [
      'error: `uv` not found.',
      '',
      'The figure cropper needs pymupdf. Install uv (https://docs.astral.sh/uv/)',
      'so this script can run it isolated without touching the harness Python:',
      '  macOS/Linux:  curl -LsSf https://astral.sh/uv/install.sh | sh',
      '  Windows:      winget install --id=astral-sh.uv -e',
      '',
      'Alternatively, read the figure text instead of cropping it, and say so.',
    ].join('\n'),
  )
  process.exit(1)
}

// pymupdf renders the crop; Pillow trims the uniform white border afterwards.
// Both stay out of the harness runtime — `--isolated --no-project` caches them.
const command = [uv, 'run', '--isolated', '--no-project', '--with', 'pymupdf', '--with', 'pillow', 'python', SCRIPT, ...args]
  .map((part) => `"${String(part).replace(/"/g, '""')}"`)
  .join(' ')

try {
  // uv downloads pymupdf on first use and writes progress to stderr; that is
  // expected, so let it through rather than hiding a real failure.
  const stdout = execFileSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: true,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  })
  process.stdout.write(stdout)
} catch (error) {
  if (typeof error?.stdout === 'string' && error.stdout.trim()) process.stdout.write(error.stdout)
  process.exit(error?.status ?? 1)
}
