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
  if (live.active && bundle.listed) {
    console.log('\nwarning: both modes are active; the live copy shadows the bundled root.')
  }
  if (!orx) console.log('\nwarning: `orx` is not on PATH, so the skills cannot run their commands.')
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

  mkdirSync(liveRoot, { recursive: true })
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
      '  node scripts/install.mjs --mode live   [--dry-run]',
      '  node scripts/install.mjs --mode bundle [--dry-run] [--profile <dir>]',
      '  node scripts/install.mjs --uninstall   [--yes] [--profile <dir>]',
    ].join('\n'),
  )
  process.exit(0)
}

if (flag('--status')) status()
else if (flag('--uninstall')) uninstall()
else if (value('--mode') === 'live') installLive()
else if (value('--mode') === 'bundle') installBundle()
else fail(`unknown invocation: ${args.join(' ')} (try --help)`)
