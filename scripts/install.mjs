#!/usr/bin/env node
/**
 * Install the OpenResearch method pack into DeepSeek Harness.
 *
 * Two mutually exclusive modes, because they register the same skill names
 * through different roots:
 *
 *   live    Copy skills/ into <dshHome>/skills. That root is watched by DSH's
 *           default filesystem provider, so the skills reach the catalog without
 *           restarting the app. Lower ceremony, but the deployed copy is a copy.
 *
 *   bundle  Wire this package into a profile's `dsh.profile.bundles` so the
 *           package's own skills/ tree is served by an isolated provider. No
 *           copied files, but bundles are composed at process start, so the app
 *           must be restarted.
 *
 * Installing both would surface every skill twice (rank 400 shadows rank 600),
 * so each mode refuses when the other is active.
 *
 * Usage:
 *   node scripts/install.mjs --status
 *   node scripts/install.mjs --mode live   [--dry-run]
 *   node scripts/install.mjs --mode bundle [--dry-run] [--profile <dir>]
 *   node scripts/install.mjs --uninstall   [--yes] [--profile <dir>]
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS = join(ROOT, 'skills')
const RECEIPT = '.openresearch-live.json'
const PACKAGE_NAME = 'dsh-openresearch'
const BUNDLE_ENTRY_ID = 'openresearch-skills'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const dryRun = flag('--dry-run')
const yes = flag('--yes')
const dshHome = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const liveRoot = join(dshHome, 'skills')
const liveReceiptPath = join(liveRoot, RECEIPT)

function say(message) {
  console.log(dryRun ? `[dry-run] ${message}` : message)
}

function fail(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}

/** Deployed skill names recorded by a previous live install. */
function readReceipt() {
  if (!existsSync(liveReceiptPath)) return null
  try {
    return JSON.parse(readFileSync(liveReceiptPath, 'utf8'))
  } catch {
    return { deployed: [] }
  }
}

/** Source skill directory names, excluding the manifest. */
function sourceSkills() {
  if (!existsSync(SKILLS)) fail(`skills/ is missing (${SKILLS}). Run: node scripts/sync-skills.mjs`)
  return readdirSync(SKILLS)
    .filter((entry) => statSync(join(SKILLS, entry)).isDirectory())
    .filter((entry) => existsSync(join(SKILLS, entry, 'SKILL.md')))
    .sort()
}

function manifestVersion() {
  try {
    return JSON.parse(readFileSync(join(SKILLS, 'MANIFEST.json'), 'utf8')).orxVersion
  } catch {
    return undefined
  }
}

/** Candidate profile directories under <dshHome>/profiles. */
function profiles() {
  const dir = join(dshHome, 'profiles')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((dir) => existsSync(join(dir, 'package.json')))
}

function resolveProfile() {
  const explicit = value('--profile')
  if (explicit) {
    const dir = resolve(explicit)
    if (!existsSync(join(dir, 'package.json'))) fail(`no package.json in profile ${dir}`)
    return dir
  }
  const found = profiles()
  const desktop = found.find((dir) => dir.endsWith(`${sep}desktop`))
  if (desktop) return desktop
  if (found.length === 1) return found[0]
  if (found.length === 0) fail(`no DSH profiles found under ${join(dshHome, 'profiles')}`)
  fail(`multiple profiles found (${found.join(', ')}); pass --profile <dir>`)
}

function readProfile(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
}

function writeProfile(dir, json) {
  const text = `${JSON.stringify(json, null, 2)}\n`
  if (dryRun) {
    say(`would write ${join(dir, 'package.json')}`)
    return
  }
  writeFileSync(join(dir, 'package.json'), text)
}

/** Whether the profile already mounts this package as a bundle. */
function bundleActive(dir) {
  const json = readProfile(dir)
  const dep = json.dependencies?.[PACKAGE_NAME]
  const bundles = json.dsh?.profile?.bundles ?? []
  return { dep, listed: bundles.includes(PACKAGE_NAME), bundles }
}

/** Whether skills/ is currently deployed into the watched user root. */
function liveActive() {
  const receipt = readReceipt()
  if (!receipt) return { active: false, deployed: [] }
  const deployed = (receipt.deployed ?? []).filter((name) =>
    existsSync(join(liveRoot, name, 'SKILL.md')),
  )
  return { active: deployed.length > 0, deployed }
}

/** Resolve `orx` exactly as a shell would: ORX_BIN, then PATH only. */
function findOrxOnPath() {
  const explicit = process.env.ORX_BIN
  if (explicit && existsSync(explicit)) return explicit
  const names = process.platform === 'win32' ? ['orx.exe', 'orx.cmd', 'orx.bat', 'orx'] : ['orx']
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
 * Resolve `orx` for local tooling, falling back to OpenResearch's Windows
 * install directory. The fallback is for this script's own reporting only: it
 * does not make the command resolvable from a shell, so `ensureCliShim` must
 * use `findOrxOnPath` instead.
 */
function findOrx() {
  const onPath = findOrxOnPath()
  if (onPath) return onPath
  if (process.platform === 'win32') {
    const installed = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'OpenResearch', 'orx.exe')
    if (existsSync(installed)) return installed
  }
  return undefined
}

/**
 * Make `orx` resolvable from shells.
 *
 * The generated skills all invoke the bare `orx` command, so an install that
 * leaves the binary off PATH produces skills that cannot act. A shim in an
 * already-PATH directory is narrower than editing the persistent user PATH and
 * is undone by deleting one file.
 */
function ensureCliShim() {
  if (findOrxOnPath()) return { ok: true, note: 'orx already resolvable from PATH' }
  const installed = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'OpenResearch', 'orx.exe')
  if (!existsSync(installed)) return { ok: false, note: 'orx.exe not found; install OpenResearch first' }

  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const target = pathDirs.map((dir) => resolve(dir)).find((dir) => dir === resolve(homedir(), '.local', 'bin'))
  if (!target) return { ok: false, note: `no writable PATH directory for an orx shim; add ${dirname(installed)} to PATH` }

  mkdirSync(target, { recursive: true })
  if (process.platform === 'win32') {
    const shim = join(target, 'orx.cmd')
    const body = `@echo off\r\n"${installed}" %*\r\n`
    if (dryRun) {
      say(`would write shim ${shim}`)
    } else {
      writeFileSync(shim, body)
    }
    return { ok: true, note: `shim ${shim} -> ${installed}` }
  }
  const shim = join(target, 'orx')
  if (dryRun) {
    say(`would write shim ${shim}`)
  } else {
    writeFileSync(shim, `#!/bin/sh\nexec "${installed}" "$@"\n`, { mode: 0o755 })
  }
  return { ok: true, note: `shim ${shim} -> ${installed}` }
}

/**
 * Compare the deployed live copy against the built `skills/` tree.
 *
 * The live mode deploys copies, so after `sync-skills.mjs` picks up a new `orx`
 * the deployed skills silently go stale. Reporting the mismatch is the only way
 * a reader learns that the catalog is describing an older CLI.
 */
function deployedDrift(live) {
  const deployed = new Set(live.deployed)
  const source = new Set(sourceSkills())
  const changed = []
  const missing = []
  for (const name of source) {
    if (!deployed.has(name)) {
      missing.push(name)
      continue
    }
    const from = join(SKILLS, name, 'SKILL.md')
    const to = join(liveRoot, name, 'SKILL.md')
    if (!existsSync(to)) {
      missing.push(name)
      continue
    }
    if (readFileSync(from, 'utf8') !== readFileSync(to, 'utf8')) changed.push(name)
  }
  const extra = [...deployed].filter((name) => !source.has(name))
  return { changed, missing, extra, clean: changed.length + missing.length + extra.length === 0 }
}

function status() {
  const profile = resolveProfile()
  const bundle = bundleActive(profile)
  const live = liveActive()
  const orx = findOrx()

  console.log(`package     ${ROOT}`)
  console.log(`dsh home    ${dshHome}`)
  console.log(`profile     ${profile}`)
  console.log(`orx         ${orx ?? 'NOT RESOLVABLE'}`)
  console.log(`skills      ${sourceSkills().length} skills, orx ${manifestVersion() ?? 'unknown'}`)
  console.log(`mode live   ${live.active ? `active (${live.deployed.length} deployed in ${liveRoot})` : 'inactive'}`)
  console.log(
    `mode bundle ${bundle.listed ? `listed in bundles (${bundle.dep})` : bundle.dep ? `dependency only (${bundle.dep})` : 'inactive'}`,
  )
  if (live.active) {
    const drift = deployedDrift(live)
    if (drift.clean) {
      console.log('deployed    matches skills/')
    } else {
      console.log(
        `deployed    DRIFT — ${drift.changed.length} changed, ${drift.missing.length} not deployed, ${drift.extra.length} stale`,
      )
      console.log('            run: node scripts/install.mjs --mode live')
    }
  }
  if (live.active && bundle.listed) {
    console.log('\nwarning: both modes are active; the live copy shadows the bundled root.')
  }
  if (!orx) console.log('\nwarning: `orx` is not on PATH, so the skills cannot run their commands.')
}

/** Run the `orx` binary the way a shell would, tolerating batch shims. */
function runOrx(bin, args) {
  const quote = (value) => `"${String(value).replace(/"/g, '""')}"`
  const options = {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  }
  return /\.(cmd|bat)$/i.test(bin)
    ? execFileSync([quote(bin), ...args.map(quote)].join(' '), { ...options, shell: true })
    : execFileSync(bin, args, options)
}

/**
 * End-to-end doctor. Every check maps to a failure a user actually hits, so the
 * output names the fix rather than only the symptom.
 *
 * `--network` adds a live alphaXiv smoke test; it costs one API call, so it is
 * opt-in and never part of a plain `--verify`.
 */
function verifyPackage() {
  const network = flag('--network')
  const profile = resolveProfile()
  const bundle = bundleActive(profile)
  const live = liveActive()
  const results = []
  const check = (label, ok, detail) => {
    results.push({ label, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  }

  console.log(`Verifying ${ROOT}\n`)

  // 1. Skills build is complete and self-consistent.
  const names = sourceSkills()
  check(
    'skills/ is built and matches MANIFEST',
    names.length > 0 && Boolean(manifestVersion()),
    `${names.length} skills, orx ${manifestVersion() ?? 'unknown'}`,
  )
  const invalid = names.filter((name) => {
    const file = join(SKILLS, name, 'SKILL.md')
    const text = readFileSync(file, 'utf8')
    const meta = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
    if (!meta) return true
    return !/^name:\s*[a-z0-9-]+\s*$/m.test(meta[1]) || !/^description:\s*\S/m.test(meta[1])
  })
  check(
    'every skill has valid DSH frontmatter',
    invalid.length === 0,
    invalid.length === 0 ? undefined : `invalid: ${invalid.join(', ')}`,
  )

  // 2. The mode wiring is a single owner, and it is actually active.
  check(
    'exactly one install mode is active',
    live.active !== bundle.listed,
    live.active ? 'live' : bundle.listed ? 'bundle' : 'neither — run --mode live or --mode bundle',
  )

  if (live.active) {
    const drift = deployedDrift(live)
    check(
      'deployed copy matches skills/',
      drift.clean,
      drift.clean
        ? `${live.deployed.length} skills`
        : `${drift.changed.length} changed, ${drift.missing.length} missing, ${drift.extra.length} stale — run --mode live`,
    )
  }

  if (bundle.listed) {
    const dep = readProfile(profile).dependencies?.[PACKAGE_NAME]
    check('profile declares the package dependency', Boolean(dep), dep ?? 'missing')
    const linked = existsSync(join(profile, 'node_modules', ...PACKAGE_NAME.split('/')))
    check('package is installed in the profile', linked, linked ? undefined : 'run pnpm install in the profile')
  }

  // 3. The CLI the skills call is reachable.
  const orx = findOrxOnPath()
  check('orx is resolvable from a shell', Boolean(orx), orx ?? 'not on PATH')
  if (orx) {
    try {
      const version = runOrx(orx, ['--version']).trim()
      check('orx runs', true, version)
    } catch (error) {
      check('orx runs', false, String(error?.message ?? error).split('\n')[0])
    }
  }

  // 4. Optional live check that retrieval actually works from here.
  if (network && orx) {
    try {
      const raw = runOrx(orx, ['discover', 'keyword', 'transformer', '--limit', '1'])
      const parsed = JSON.parse(raw)
      check(
        'alphaXiv retrieval returns results',
        Array.isArray(parsed) && parsed.length > 0,
        Array.isArray(parsed) ? `${parsed.length} result(s)` : 'unexpected payload',
      )
    } catch (error) {
      check('alphaXiv retrieval returns results', false, String(error?.message ?? error).split('\n')[0])
    }
  } else if (network) {
    check('alphaXiv retrieval returns results', false, 'skipped: orx not resolvable')
  }

  const failed = results.filter((result) => !result.ok)
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed${network ? '' : ' (add --network for a live retrieval test)'}.`,
  )
  if (failed.length > 0) process.exitCode = 1
}

function installLive() {
  const bundle = bundleActive(resolveProfile())
  if (bundle.listed) {
    fail(
      `${PACKAGE_NAME} is already installed in bundle mode; installing live mode too would register every skill twice. Run --mode bundle --uninstall first.`,
    )
  }
  const receipt = readReceipt()
  const owned = new Set(receipt?.deployed ?? [])
  const names = sourceSkills()

  // A dry run must not touch the filesystem, so the root is only created when
  // the deployment is real.
  if (!dryRun) mkdirSync(liveRoot, { recursive: true })
  for (const name of names) {
    const target = join(liveRoot, name)
    if (existsSync(target) && !owned.has(name)) {
      fail(
        `${target} already exists and was not deployed by this package; refusing to overwrite it.`,
      )
    }
    say(`deploy ${name} -> ${target}`)
    if (dryRun) continue
    rmSync(target, { recursive: true, force: true })
    cpSync(join(SKILLS, name), target, { recursive: true })
  }

  // Remove skills this package deployed from an earlier orx version but no
  // longer ships, so the catalog cannot advertise a dead command surface.
  const stale = [...owned].filter((name) => !names.includes(name))
  for (const name of stale) {
    const target = join(liveRoot, name)
    if (!existsSync(target)) continue
    const rel = relative(liveRoot, target)
    if (rel.startsWith('..') || rel.includes(sep)) {
      fail(`refusing to remove ${target}: outside ${liveRoot}`)
    }
    say(`remove stale ${name} -> ${target}`)
    if (!dryRun) rmSync(target, { recursive: true, force: true })
  }

  if (!dryRun) {
    writeFileSync(
      liveReceiptPath,
      `${JSON.stringify(
        {
          package: PACKAGE_NAME,
          source: SKILLS,
          orxVersion: manifestVersion(),
          deployed: names,
          at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    )
  }

  const shim = ensureCliShim()
  console.log(`\nlive mode: ${names.length} skills in ${liveRoot}`)
  console.log(`cli: ${shim.ok ? shim.note : `ACTION NEEDED  E${shim.note}`}`)
  if (stale.length > 0) console.log(`removed ${stale.length} stale skill(s)`)
  console.log('DSH watches this root, so the skills reach the next model step without a restart.')
}

function installBundle() {
  const live = liveActive()
  if (live.active) {
    fail(
      `live mode is active (${live.deployed.length} skills in ${liveRoot}); installing bundle mode too would register every skill twice. Run --uninstall first.`,
    )
  }
  const profile = resolveProfile()
  const json = readProfile(profile)
  const posix = ROOT.replace(/\\/g, '/')

  json.dependencies ??= {}
  json.dependencies[PACKAGE_NAME] = `file:${posix}`
  json.dsh ??= {}
  json.dsh.profile ??= {}
  json.dsh.profile.bundles ??= []
  if (!json.dsh.profile.bundles.includes(PACKAGE_NAME)) {
    json.dsh.profile.bundles.push(PACKAGE_NAME)
  }
  writeProfile(profile, json)
  say(`wired ${PACKAGE_NAME} into ${join(profile, 'package.json')}`)

  if (!dryRun) {
    console.log(`\ninstalling dependencies in ${profile} …`)
    try {
      execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['install'], {
        cwd: profile,
        stdio: 'inherit',
      })
    } catch {
      fail(`pnpm install failed in ${profile}; fix it, or use --mode live instead.`)
    }
  }

  const shim = ensureCliShim()
  console.log(`\nbundle mode: ${BUNDLE_ENTRY_ID} listed in dsh.profile.bundles`)
  console.log(`cli: ${shim.ok ? shim.note : `ACTION NEEDED  E${shim.note}`}`)
  console.log('Restart DeepSeek Harness to compose the bundle (bundles load at process start).')
}

function uninstall() {
  const profile = resolveProfile()
  const bundle = bundleActive(profile)
  const live = liveActive()

  const plan = []
  if (live.active) plan.push(`remove ${live.deployed.length} skill dir(s) from ${liveRoot}`)
  if (bundle.listed || bundle.dep) plan.push(`unwire ${PACKAGE_NAME} from ${profile}`)

  if (plan.length === 0) {
    console.log('Nothing installed.')
    return
  }
  console.log('Will:')
  for (const step of plan) console.log(`  - ${step}`)
  if (!yes && !dryRun) {
    console.log('\nRe-run with --yes to apply.')
    return
  }

  for (const name of live.deployed) {
    const target = join(liveRoot, name)
    const rel = relative(liveRoot, target)
    // Refuse any path that escapes the skills root, then confirm the directory
    // really looks like a skill this package deployed.
    if (rel.startsWith('..') || rel.includes(sep)) fail(`refusing to remove ${target}: outside ${liveRoot}`)
    if (!existsSync(join(target, 'SKILL.md'))) fail(`refusing to remove ${target}: no SKILL.md`)
    say(`remove ${target}`)
    if (!dryRun) rmSync(target, { recursive: true, force: true })
  }
  if (existsSync(liveReceiptPath)) {
    say(`remove ${liveReceiptPath}`)
    if (!dryRun) rmSync(liveReceiptPath, { force: true })
  }

  if (bundle.listed || bundle.dep) {
    const json = readProfile(profile)
    if (json.dependencies) delete json.dependencies[PACKAGE_NAME]
    const bundles = json.dsh?.profile?.bundles
    if (Array.isArray(bundles)) {
      json.dsh.profile.bundles = bundles.filter((entry) => entry !== PACKAGE_NAME)
    }
    writeProfile(profile, json)
    if (!dryRun) {
      try {
        execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['install'], {
          cwd: profile,
          stdio: 'inherit',
        })
      } catch {
        console.error('warning: pnpm install failed; the profile dependency may still be installed.')
      }
    }
  }
  console.log('\nUninstalled.')
}

if (flag('--help') || flag('-h') || args.length === 0) {
  console.log(
    [
      'Usage:',
      '  node scripts/install.mjs --status',
      '  node scripts/install.mjs --verify        [--network] [--profile <dir>]',
      '  node scripts/install.mjs --mode live   [--dry-run]',
      '  node scripts/install.mjs --mode bundle [--dry-run] [--profile <dir>]',
      '  node scripts/install.mjs --uninstall   [--yes] [--profile <dir>]',
    ].join('\n'),
  )
  process.exit(0)
}

if (flag('--status')) status()
else if (flag('--verify')) verifyPackage()
else if (flag('--uninstall')) uninstall()
else if (value('--mode') === 'live') installLive()
else if (value('--mode') === 'bundle') installBundle()
else fail(`unknown invocation: ${args.join(' ')} (try --help)`)
