/**
 * The bundle adapter can only be exercised inside DSH, because it imports a
 * host package that does not exist outside the app. That left bundle mode
 * entirely unverified: a typo in `inject`, a wrong option name, or an early
 * return would only surface after a restart.
 *
 * These tests run the adapter against a stub of the host package, in a temp
 * layout that mirrors how the package is laid out when installed into a profile.
 * They prove the adapter's shape (what Cordis calls) and the exact options it
 * hands the provider.
 */
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Build a fake package install: <tmp>/src/index.mjs + <tmp>/skills + stub host package. */
function install(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-orx-bundle-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  mkdirSync(join(dir, 'src'), { recursive: true })
  cpSync(join(ROOT, 'src', 'index.mjs'), join(dir, 'src', 'index.mjs'))
  cpSync(join(ROOT, 'skills'), join(dir, 'skills'), { recursive: true })

  const host = join(dir, 'node_modules', '@deepseek-ai', 'dsh-skill-filesystem')
  mkdirSync(host, { recursive: true })
  writeFileSync(
    join(host, 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh-skill-filesystem', version: '0.0.0-stub', type: 'module', main: 'index.js' }),
  )
  writeFileSync(
    join(host, 'index.js'),
    [
      'export const calls = []',
      'export function apply(ctx, config = {}) {',
      '  calls.push({ ctx, config })',
      '  // Mirrors the real provider: it needs a registry, and it registers one',
      '  // provider factory for the configured roots.',
      '  if (typeof ctx.skills?.registerProvider !== "function") {',
      '    throw new Error("stub: ctx.skills.registerProvider is required")',
      '  }',
      '  ctx.skills.registerProvider(() => ({ config }))',
      '}',
    ].join('\n'),
  )
  return { dir, host, adapter: join(dir, 'src', 'index.mjs') }
}

test('the adapter exports the shape Cordis expects', async (t) => {
  const box = install(t)
  const mod = await import(pathToFileURL(box.adapter).href)
  assert.equal(mod.name, 'openresearch-skills')
  assert.deepEqual(mod.inject, ['skills'])
  assert.equal(typeof mod.apply, 'function')
})

test('apply registers exactly one isolated provider over the packaged skills', async (t) => {
  const box = install(t)
  const mod = await import(pathToFileURL(box.adapter).href)
  const stub = await import(pathToFileURL(join(box.host, 'index.js')).href)

  let registered = 0
  const ctx = {
    skills: { registerProvider: () => { registered += 1 } },
    effect: () => {},
    on: () => {},
  }
  mod.apply(ctx)

  assert.equal(registered, 1, 'one provider registered')
  assert.equal(stub.calls.length, 1, 'host apply called once')

  const { config } = stub.calls[0]
  assert.equal(config.providerName, 'openresearch')
  // Isolated is the whole point: a second default-scanning provider would list
  // every skill twice, once per root.
  assert.equal(config.includeDefaultRoots, false)
  assert.equal(config.watch, false)
  assert.equal(resolve(config.bundledSkillDir), resolve(join(box.dir, 'skills')))
})

test('apply skips registration when the skills tree is missing', async (t) => {
  const box = install(t)
  rmSync(join(box.dir, 'skills'), { recursive: true, force: true })
  const mod = await import(pathToFileURL(box.adapter).href)
  const stub = await import(pathToFileURL(join(box.host, 'index.js')).href)

  const warnings = []
  const ctx = {
    skills: { registerProvider: () => assert.fail('must not register without skills') },
    effect: () => {},
    on: () => {},
    logger: { warn: (message) => warnings.push(message) },
  }
  mod.apply(ctx)
  assert.equal(stub.calls.length, 0)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /sync-skills\.mjs/)
})

test('the bundle patch inserts exactly this package', () => {
  // The patch is what Cordis reads before any code runs, so a broken entry is
  // the earliest possible failure — check it as data, not by trusting the YAML.
  const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
  const entries = patch.split(/\r?\n/).filter((line) => /^\s*-\s+id:/.test(line))
  assert.equal(entries.length, 1, 'exactly one inserted entry')
  assert.match(patch, /^\s*-\s+id:\s*openresearch-skills\s*$/m)
  assert.match(patch, /^\s*name:\s*['"]?dsh-openresearch['"]?\s*$/m)
})

test('package.json points the bundle at the patch and the adapter', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.main, 'src/index.mjs')
  assert.equal(pkg.exports['.'], './src/index.mjs')
  // Declaring `skills` in `files` is what keeps the built tree in the tarball;
  // without it a published install would mount an empty directory.
  assert.ok(pkg.files.includes('skills'), 'skills/ is packaged')
})
