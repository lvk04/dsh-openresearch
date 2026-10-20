import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { frontmatter, moduleNames, normalize } from '../scripts/sync-skills.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('frontmatter reads name and description', () => {
  const doc = ['---', 'name: orx-create', 'description: "Do a thing."', '---', '', '# Body'].join('\n')
  assert.deepEqual(frontmatter(doc), { name: 'orx-create', description: 'Do a thing.' })
})

test('frontmatter returns null without a block', () => {
  assert.equal(frontmatter('# Just a heading\n'), null)
})

test('frontmatter unescapes quotes and accepts single quotes', () => {
  const doc = ['---', "name: a-b", "description: 'say \"hi\"'", '---', ''].join('\n')
  assert.equal(frontmatter(doc).description, 'say "hi"')
})

test('frontmatter keeps a description that contains a colon', () => {
  const doc = ['---', 'name: x-y', 'description: "Use when: ready"', '---', ''].join('\n')
  assert.equal(frontmatter(doc).description, 'Use when: ready')
})

test('moduleNames reads the bundled index and ignores prose', () => {
  const overview = [
    'Some prose about orx-create that is not the index.',
    'Bundled modules (orx skill <name>):',
    '  orx-create           Initialize a project.',
    '  orx-experiment-tree  Plan and drive the tree.',
    '',
    'Trailing prose mentioning orx-not-a-module here.',
  ].join('\n')
  assert.deepEqual(moduleNames(overview), ['orx-create', 'orx-experiment-tree'])
})

test('moduleNames fails loudly when the index is absent', () => {
  assert.throws(() => moduleNames('no index here'), /Bundled modules/)
})

test('moduleNames fails when the index is empty', () => {
  assert.throws(() => moduleNames('Bundled modules (orx skill <name>):\n'), /empty/)
})

test('normalize collapses CRLF and trailing blank lines', () => {
  assert.equal(normalize('a\r\nb\r\n\r\n'), 'a\nb\n')
  assert.equal(normalize('a\nb'), 'a\nb\n')
})

test('skills/ on disk matches the installed orx build', () => {
  // Integration check: this is the same gate CI runs, and it catches a stale
  // build after an orx upgrade as well as a hand-edit to a generated skill.
  const node = process.execPath
  const output = execFileSync(node, [join(ROOT, 'scripts', 'sync-skills.mjs'), '--check'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.match(output, /skills\/ matches orx/)
})

test('offline integrity check passes on the committed tree', () => {
  // Runs without the orx binary, so this is the CI gate.
  const node = process.execPath
  const output = execFileSync(node, [join(ROOT, 'scripts', 'sync-skills.mjs'), '--check', '--offline'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.match(output, /integrity OK/)
})

test('offline integrity check rejects a hand-edited skill', () => {
  // Copy the repo tree so the real skills/ is never mutated by a test.
  const dir = mkdtempSync(join(tmpdir(), 'dsh-orx-integrity-'))
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    cpSync(join(ROOT, 'scripts', 'sync-skills.mjs'), join(dir, 'scripts', 'sync-skills.mjs'))
    cpSync(join(ROOT, 'skills'), join(dir, 'skills'), { recursive: true })
    writeFileSync(join(dir, 'skills', 'orx-create', 'SKILL.md'), '---\nname: orx-create\ndescription: tampered\n---\n')

    const node = process.execPath
    let failed
    try {
      execFileSync(node, [join(dir, 'scripts', 'sync-skills.mjs'), '--check', '--offline'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      failed = String(error.stderr ?? '')
    }
    assert.ok(failed !== undefined, 'tampered tree must fail the check')
    assert.match(failed, /does not match MANIFEST/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
