import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INSTALL = join(ROOT, 'scripts', 'install.mjs')
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'skills', 'MANIFEST.json'), 'utf8'))
const SKILL_COUNT = readdirSync(join(ROOT, 'skills'), { withFileTypes: true }).filter(
  (entry) => entry.isDirectory(),
).length

/**
 * A throwaway DSH home with one profile, so installer behaviour is exercised
 * without touching the real `~/.dsh` or `~/.local/bin`.
 *
 * `ORX_BIN` points at a dummy file so the CLI-shim step short-circuits: it
 * reports orx as already resolvable instead of writing into the user's PATH.
 */
function sandbox(t) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-openresearch-test-'))
  const profile = join(home, 'profiles', 'desktop')
  mkdirSync(profile, { recursive: true })
  writeFileSync(
    join(profile, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-desktop', private: true, dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }, null, 2),
  )
  // A runnable stand-in, so `--verify`'s "orx runs" check can pass without the
  // real CLI. On Windows it is a .cmd, which also exercises the batch-shim path.
  const isWindows = process.platform === 'win32'
  const dummyOrx = join(home, isWindows ? 'orx-dummy.cmd' : 'orx-dummy')
  writeFileSync(
    dummyOrx,
    isWindows ? '@echo off\r\necho orx 0.0.0-test\r\n' : '#!/bin/sh\necho "orx 0.0.0-test"\n',
    isWindows ? {} : { mode: 0o755 },
  )
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const env = { ...process.env, DSH_HOME: home, ORX_BIN: dummyOrx }
  const run = (args) => {
    try {
      const stdout = execFileSync(process.execPath, [INSTALL, ...args], {
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return { code: 0, stdout, stderr: '' }
    } catch (error) {
      return { code: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') }
    }
  }
  return { home, profile, run, skillsRoot: join(home, 'skills') }
}

test('dry-run reports work without creating anything', (t) => {
  const box = sandbox(t)
  const result = box.run(['--mode', 'live', '--dry-run'])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /\[dry-run\] deploy openresearch-cli/)
  assert.equal(existsSync(box.skillsRoot), false)
})

test('live install deploys every built skill and writes a receipt', (t) => {
  const box = sandbox(t)
  assert.equal(box.run(['--mode', 'live']).code, 0)
  for (const name of readdirSync(join(ROOT, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)) {
    assert.ok(existsSync(join(box.skillsRoot, name, 'SKILL.md')), `${name} deployed`)
  }
  const receipt = JSON.parse(readFileSync(join(box.skillsRoot, '.openresearch-live.json'), 'utf8'))
  assert.equal(receipt.deployed.length, SKILL_COUNT)
  assert.equal(receipt.orxVersion, MANIFEST.orxVersion)
})

test('live install is idempotent', (t) => {
  const box = sandbox(t)
  assert.equal(box.run(['--mode', 'live']).code, 0)
  assert.equal(box.run(['--mode', 'live']).code, 0)
  const dirs = readdirSync(box.skillsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  assert.equal(dirs.length, SKILL_COUNT)
})

test('status reports a clean deployment with no drift', (t) => {
  const box = sandbox(t)
  box.run(['--mode', 'live'])
  const result = box.run(['--status'])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /deployed {4}matches skills\//)
})

test('status reports drift after a deployed skill is edited', (t) => {
  const box = sandbox(t)
  box.run(['--mode', 'live'])
  const victim = join(box.skillsRoot, 'orx-create', 'SKILL.md')
  writeFileSync(victim, `${readFileSync(victim, 'utf8')}\nhand edit\n`)
  const result = box.run(['--status'])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /DRIFT — 1 changed/)
})

test('a pre-existing foreign skill directory is never overwritten', (t) => {
  const box = sandbox(t)
  const foreign = join(box.skillsRoot, 'orx-create')
  mkdirSync(foreign, { recursive: true })
  writeFileSync(join(foreign, 'SKILL.md'), '---\nname: orx-create\ndescription: mine\n---\n')
  const result = box.run(['--mode', 'live'])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /refusing to overwrite/)
  assert.equal(readFileSync(join(foreign, 'SKILL.md'), 'utf8'), '---\nname: orx-create\ndescription: mine\n---\n')
})

test('bundle mode is refused while live mode is active', (t) => {
  const box = sandbox(t)
  box.run(['--mode', 'live'])
  const result = box.run(['--mode', 'bundle', '--dry-run'])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /twice/)
})

test('bundle dry-run wires the profile without writing it', (t) => {
  const box = sandbox(t)
  const before = readFileSync(join(box.profile, 'package.json'), 'utf8')
  const result = box.run(['--mode', 'bundle', '--dry-run'])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /would write/)
  assert.equal(readFileSync(join(box.profile, 'package.json'), 'utf8'), before)
})

test('uninstall without --yes changes nothing', (t) => {
  const box = sandbox(t)
  box.run(['--mode', 'live'])
  const result = box.run(['--uninstall'])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /Re-run with --yes/)
  assert.ok(existsSync(join(box.skillsRoot, '.openresearch-live.json')))
})

test('uninstall --yes removes exactly the deployed skills', (t) => {
  const box = sandbox(t)
  box.run(['--mode', 'live'])
  assert.equal(box.run(['--uninstall', '--yes']).code, 0)
  assert.equal(existsSync(join(box.skillsRoot, '.openresearch-live.json')), false)
  assert.equal(existsSync(join(box.skillsRoot, 'orx-create')), false)
})

test('uninstall leaves skills this package did not deploy', (t) => {
  const box = sandbox(t)
  box.run(['--mode', 'live'])
  const mine = join(box.skillsRoot, 'my-own-skill')
  mkdirSync(mine, { recursive: true })
  writeFileSync(join(mine, 'SKILL.md'), '---\nname: my-own-skill\ndescription: keep me\n---\n')
  box.run(['--uninstall', '--yes'])
  assert.ok(existsSync(join(mine, 'SKILL.md')))
})

test('verify fails loudly when no mode is active', (t) => {
  const box = sandbox(t)
  const result = box.run(['--verify'])
  assert.equal(result.code, 1)
  assert.match(result.stdout, /FAIL {2}exactly one install mode is active/)
  assert.match(result.stdout, /checks passed/)
})

test('verify fails when the deployed copy no longer matches skills/', (t) => {
  // The README promises each failure names the fix, so assert the drift failure
  // reports the remedy rather than only the symptom.
  const box = sandbox(t)
  box.run(['--mode', 'live'])
  const victim = join(box.skillsRoot, 'orx-create', 'SKILL.md')
  writeFileSync(victim, `${readFileSync(victim, 'utf8')}\nhand edit\n`)
  const result = box.run(['--verify'])
  assert.equal(result.code, 1)
  assert.match(result.stdout, /FAIL {2}deployed copy matches skills\//)
  assert.match(result.stdout, /run --mode live/)
})

test('verify passes on a clean live install', (t) => {
  const box = sandbox(t)
  box.run(['--mode', 'live'])
  const result = box.run(['--verify'])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /deployed copy matches skills\//)
  assert.match(result.stdout, /exactly one install mode is active — live/)
})
