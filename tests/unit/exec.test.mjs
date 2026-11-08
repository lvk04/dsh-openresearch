import assert from 'node:assert/strict'
import test from 'node:test'
import { runOrx, stripAnsi, normalizeOutput } from '../../src/server/orx/exec.mjs'

test('stripAnsi removes ANSI escape codes', () => {
  const colored = '\u001b[31mRed\u001b[0m \u001b[1mBold\u001b[0m'
  assert.equal(stripAnsi(colored), 'Red Bold')
})

test('normalizeOutput strips CRLF and ANSI', () => {
  const input = '\u001b[32mLine 1\u001b[0m\r\nLine 2\r\n'
  assert.equal(normalizeOutput(input), 'Line 1\nLine 2\n')
})

test('runOrx throws ORX_MISSING when binary is absent', async () => {
  await assert.rejects(
    async () => {
      await runOrx(['--version'], {
        env: { PATH: '', LOCALAPPDATA: '' },
      })
    },
    { code: 'ORX_MISSING' },
  )
})

test('runOrx executes node script as fake orx successfully', async () => {
  const fakeScript = 'console.log("hello from fake orx"); process.exit(0);'
  const res = await runOrx(['-e', fakeScript], {
    binPath: process.execPath,
  })
  assert.equal(res.code, 0)
  assert.match(res.stdout, /hello from fake orx/)
  assert.equal(res.stderr, '')
})

test('runOrx captures non-zero exit code and stderr', async () => {
  const fakeScript = 'console.error("fatal error"); process.exit(42);'
  const res = await runOrx(['-e', fakeScript], {
    binPath: process.execPath,
  })
  assert.equal(res.code, 42)
  assert.match(res.stderr, /fatal error/)
})

test('runOrx honors timeoutMs', async () => {
  const fakeScript = 'setTimeout(() => {}, 10000);'
  await assert.rejects(
    async () => {
      await runOrx(['-e', fakeScript], {
        binPath: process.execPath,
        timeoutMs: 150,
      })
    },
    { code: 'ETIMEDOUT' },
  )
})

test('runOrx honors AbortSignal', async () => {
  const controller = new AbortController()
  const fakeScript = 'setTimeout(() => {}, 10000);'
  const promise = runOrx(['-e', fakeScript], {
    binPath: process.execPath,
    signal: controller.signal,
    timeoutMs: 10000,
  })
  setTimeout(() => controller.abort(), 100)
  await assert.rejects(promise, { code: 'ABORT_ERR' })
})
