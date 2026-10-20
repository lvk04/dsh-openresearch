import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INSTALL = join(ROOT, 'scripts', 'install.mjs')
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'skills', 'MANIFEST.json'), 'utf8'))
const SKILL_COUNT = readdirSync(join(ROOT, 'skills'), { withFileTypes: true }).filter(
  (entry) => entry.isDirectory(),
).length

/**
 * Locate `pnpm` the way the installer does. Bundle-mode tests skip when it is
 * absent rather than pretending the mode was verified.
 */
function findPnpm() {
  const explicit = process.env.PNPM_BIN
  if (explicit && existsSync(explicit)) return explicit
  const names = process.platform === 'win32' ? ['pnpm.cmd', 'pnpm.exe', 'pnpm'] : ['pnpm']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

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
  // Mirror the real profile's pnpm settings: without `autoInstallPeers: false`
  // and a hoisted linker, bundle-mode installs differ from the supported shape.
  writeFileSync(
    join(profile, 'pnpm-workspace.yaml'),
    'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n',
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

test('bundle mode wires the profile and installs the package', (t) => {
  const pnpm = findPnpm()
  if (!pnpm) {
    t.skip('pnpm not available')
    return
  }

  const home = mkdtempSync(join(tmpdir(), 'dsh-orx-bundle-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const profile = join(home, 'profiles', 'desktop')
  mkdirSync(profile, { recursive: true })
  writeFileSync(
    join(profile, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-desktop', private: true, dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }),
  )
  writeFileSync(
    join(profile, 'pnpm-workspace.yaml'),
    'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n',
  )
  const dummyOrx = join(home, process.platform === 'win32' ? 'orx-dummy.cmd' : 'orx-dummy')
  writeFileSync(
    dummyOrx,
    process.platform === 'win32' ? '@echo off\r\necho orx 0.0.0-test\r\n' : '#!/bin/sh\necho "orx 0.0.0-test"\n',
    process.platform === 'win32' ? {} : { mode: 0o755 },
  )

  const env = {
    ...process.env,
    DSH_HOME: home,
    ORX_BIN: dummyOrx,
    PNPM_BIN: pnpm,
    // Keep the package store inside the sandbox so the test cannot touch the
    // user's real pnpm store.
    npm_config_store_dir: join(home, '.pnpm-store'),
  }

  let result
  try {
    result = { code: 0, stdout: execFileSync(process.execPath, [INSTALL, '--mode', 'bundle', '--profile', profile], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }) }
  } catch (error) {
    result = { code: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') }
  }
  assert.equal(result.code, 0, `bundle install failed: ${result.stderr ?? ''}`)

  const wired = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  assert.ok(wired.dependencies['dsh-openresearch'], 'dependency declared')
  // Never `file:<absolute>`: pnpm 10 resolves that against the profile directory
  // on Windows and dies with ENOENT on `<profile>\D:\...`. A relative spec or a
  // link both survive; which one appears depends on whether the profile and this
  // checkout share a drive, so the matrix exercises both.
  assert.match(
    wired.dependencies['dsh-openresearch'],
    /^(file:\.\.|link:)/,
    `portable dependency spec, got ${wired.dependencies['dsh-openresearch']}`,
  )
  assert.ok(wired.dsh.profile.bundles.includes('dsh-openresearch'), 'listed as a bundle')

  // The whole point of bundle mode: the package's own skills tree is what the
  // provider mounts, so it must actually exist inside the profile.
  const installed = join(profile, 'node_modules', 'dsh-openresearch')
  assert.ok(existsSync(join(installed, 'skills', 'MANIFEST.json')), 'skills packaged into node_modules')
  assert.ok(existsSync(join(installed, 'cordis.patch.yml')), 'patch reachable')
  assert.ok(existsSync(join(installed, 'src', 'index.mjs')), 'adapter reachable')
})

test('verify reports bundle mode once the profile is wired', (t) => {
  const pnpm = findPnpm()
  if (!pnpm) {
    t.skip('pnpm not available')
    return
  }
  const home = mkdtempSync(join(tmpdir(), 'dsh-orx-bundle-verify-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const profile = join(home, 'profiles', 'desktop')
  mkdirSync(profile, { recursive: true })
  writeFileSync(
    join(profile, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-desktop', private: true, dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }),
  )
  writeFileSync(
    join(profile, 'pnpm-workspace.yaml'),
    'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n',
  )
  const dummyOrx = join(home, process.platform === 'win32' ? 'orx-dummy.cmd' : 'orx-dummy')
  writeFileSync(
    dummyOrx,
    process.platform === 'win32' ? '@echo off\r\necho orx 0.0.0-test\r\n' : '#!/bin/sh\necho "orx 0.0.0-test"\n',
    process.platform === 'win32' ? {} : { mode: 0o755 },
  )
  const env = {
    ...process.env,
    DSH_HOME: home,
    ORX_BIN: dummyOrx,
    PNPM_BIN: pnpm,
    npm_config_store_dir: join(home, '.pnpm-store'),
  }

  execFileSync(process.execPath, [INSTALL, '--mode', 'bundle', '--profile', profile], {
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const result = execFileSync(process.execPath, [INSTALL, '--verify', '--profile', profile], {
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.match(result, /exactly one install mode is active — bundle/)
  assert.match(result, /profile declares the package dependency/)
  assert.match(result, /package is installed in the profile/)
  assert.match(result, /checks passed/)
})

test('the CLI shim is written for both PowerShell/cmd and bash', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-orx-shim-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))

  const user = join(home, 'user')
  const localAppData = join(home, 'localappdata')
  const exe = join(localAppData, 'Programs', 'OpenResearch', 'orx.exe')
  const bin = join(user, '.local', 'bin')
  const profile = join(home, 'profiles', 'desktop')
  mkdirSync(dirname(exe), { recursive: true })
  mkdirSync(bin, { recursive: true })
  mkdirSync(profile, { recursive: true })
  writeFileSync(exe, 'stub')
  writeFileSync(
    join(profile, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-desktop', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }),
  )

  const env = { ...process.env, DSH_HOME: home, HOME: user, USERPROFILE: user, LOCALAPPDATA: localAppData, PATH: bin }
  // No ORX_BIN: the shim path must be taken, not short-circuited.
  delete env.ORX_BIN

  // This test writes into "the user's PATH directory". Confirm the child will
  // resolve homedir() to the throwaway directory before letting it run, so a
  // platform that ignores USERPROFILE/HOME can never touch the real one.
  const resolvedHome = execFileSync(process.execPath, ['-e', 'process.stdout.write(require("node:os").homedir())'], {
    encoding: 'utf8',
    env,
  })
  if (resolve(resolvedHome) !== resolve(user)) {
    t.skip(`homedir() resolves to ${resolvedHome}, not the sandbox; refusing to write shims`)
    return
  }

  try {
    execFileSync(process.execPath, [INSTALL, '--mode', 'live'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    assert.fail(`install failed: ${String(error.stderr ?? error).split('\n')[0]}`)
  }

  // bash does an exact-name lookup, so the extensionless shim is what makes
  // `orx` work in Git Bash; cmd.exe and PowerShell need the .cmd.
  assert.ok(existsSync(join(bin, 'orx')), 'POSIX shim written')
  assert.match(readFileSync(join(bin, 'orx'), 'utf8'), /^#!\/bin\/sh\nexec "/)
  if (process.platform === 'win32') {
    assert.ok(existsSync(join(bin, 'orx.cmd')), 'batch shim written')
  }
})
