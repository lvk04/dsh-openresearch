import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WRAPPER = join(ROOT, 'scripts', 'paper-figure.mjs')

/** Locate `uv` the same way the wrapper does. */
function findUv() {
  const explicit = process.env.UV_BIN
  if (explicit && existsSync(explicit)) return explicit
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, process.platform === 'win32' ? 'uv.exe' : 'uv')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** Build a two-panel-style fixture: art cluster above, caption below. */
const MAKE_PDF = `
import sys
import pymupdf

out = sys.argv[1]
doc = pymupdf.open()
page = doc.new_page(width=612, height=792)

# Body text above the figure, so a naive gap search has a block to trip over.
page.insert_text((60, 60), "Body paragraph text above the figure.", fontsize=10)

# The figure: many small vector strokes, as real plots are.
for i in range(40):
    x = 100 + i * 9
    page.draw_line((x, 120), (x, 300), color=(0, 0, 0), width=0.6)
page.draw_rect(pymupdf.Rect(100, 120, 460, 300), color=(0, 0, 0), width=1)

# Caption immediately below, in the same column.
page.insert_text((100, 330), "Figure 1: Synthetic regression fixture.", fontsize=10)

doc.save(out)
print(out)
`

test('--help exits cleanly and prints usage', () => {
  const output = execFileSync(process.execPath, [WRAPPER, '--help'], { encoding: 'utf8' })
  assert.match(output, /--arxiv <id> --figure <n> --out <png>/)
})

test('--help still works when uv is missing', () => {
  // Regression: the uv lookup used to run first, so asking a tool what it does
  // failed on any machine without its dependency installed.
  const output = execFileSync(process.execPath, [WRAPPER, '--help'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '', UV_BIN: '' },
  })
  assert.match(output, /--arxiv <id> --figure <n> --out <png>/)
})

test('cropping picks the art cluster nearest the caption', (t) => {
  const uv = findUv()
  if (!uv) {
    t.skip('uv not available; pymupdf fixture cannot be built')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'dsh-orx-figure-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const script = join(dir, 'make_pdf.py')
  writeFileSync(script, MAKE_PDF)
  const pdf = join(dir, 'fixture.pdf')
  const quote = (value) => `"${String(value).replace(/"/g, '""')}"`
  try {
    execFileSync(
      [quote(uv), 'run', '--isolated', '--no-project', '--with', 'pymupdf', 'python', quote(script), quote(pdf)]
        .join(' '),
      { shell: true, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
    )
  } catch (error) {
    t.skip(`could not build the PDF fixture: ${String(error?.stderr ?? error).split('\n')[0]}`)
    return
  }

  const png = join(dir, 'figure1.png')
  const output = execFileSync(process.execPath, [WRAPPER, '--pdf', pdf, '--figure', '1', '--out', png], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const result = JSON.parse(output)
  assert.equal(result.page, 1)
  assert.match(result.caption, /Synthetic regression fixture/)
  assert.ok(existsSync(png), 'crop written')
  // The figure spans ~360pt; at 200 DPI that is roughly 1000px. A crop that
  // collapsed onto body text or the caption would be far narrower.
  assert.ok(result.width > 600, `crop is wide enough (got ${result.width}px)`)
  assert.ok(result.height > 300, `crop is tall enough (got ${result.height}px)`)
})

test('a caption with no figure nearby fails with an actionable message', (t) => {
  const uv = findUv()
  if (!uv) {
    t.skip('uv not available')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'dsh-orx-nofig-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const script = join(dir, 'plain.py')
  writeFileSync(
    script,
    ['import sys', 'import pymupdf', 'doc = pymupdf.open()', 'page = doc.new_page()',
     'page.insert_text((72, 72), "Figure 2: caption only, no art.", fontsize=10)',
     'doc.save(sys.argv[1])'].join('\n'),
  )
  const pdf = join(dir, 'plain.pdf')
  const quote = (value) => `"${String(value).replace(/"/g, '""')}"`
  execFileSync(
    [quote(uv), 'run', '--isolated', '--no-project', '--with', 'pymupdf', 'python', quote(script), quote(pdf)]
      .join(' '),
    { shell: true, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
  )

  let failed
  try {
    execFileSync(process.execPath, [WRAPPER, '--pdf', pdf, '--figure', '2', '--out', join(dir, 'x.png')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    failed = String(error.stderr ?? '')
  }
  assert.ok(failed !== undefined, 'command failed as expected')
  assert.match(failed, /no drawing or image geometry found|--page/)
})
