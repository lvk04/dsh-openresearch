import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  parseProjectsJson,
  parseProjectView,
  parseRunsTable,
  parseExperimentStatus,
  parseLogSummary,
} from '../../src/server/orx/parse.mjs'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const readFixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')

test('parseProjectsJson parses real sanitized projects.json fixture', () => {
  const json = readFixture('projects.json')
  const projects = parseProjectsJson(json)
  assert.ok(Array.isArray(projects))
  assert.ok(projects.length >= 1)
  assert.equal(projects[0].id, 'demo_nanochat_v1')
  assert.equal(projects[0].name, 'nanochat (demo)')
  assert.equal(projects[0].baselineBranch, 'main')
})

test('parseProjectsJson throws ORX_PARSE_FAILED on bad JSON or missing fields', () => {
  assert.throws(
    () => parseProjectsJson('{ not: array }'),
    (err) => err.code === 'ORX_PARSE_FAILED',
  )
  assert.throws(
    () => parseProjectsJson('[{ "only": "one" }]'),
    (err) => err.code === 'ORX_PARSE_FAILED',
  )
})

test('parseProjectView parses real project-view.txt fixture', () => {
  const text = readFixture('project-view.txt')
  const parsed = parseProjectView(text)
  assert.equal(parsed.id, 'demo_nanochat_v1')
  assert.equal(parsed.name, 'nanochat (demo)')
  assert.equal(parsed.branch, 'main')
  assert.equal(parsed.command, 'bash runs/runcpu.sh')
  assert.equal(parsed.experiments.length, 3)

  const rootExp = parsed.experiments[0]
  assert.equal(rootExp.id, 'demo_nanochat_cpu_v1')
  assert.equal(rootExp.title, 'CPU Apple-Silicon end-to-end baseline')
  assert.equal(rootExp.isRoot, true)
  assert.equal(rootExp.branch, 'orx/cpu-apple-silicon-end-to-end-baseline')
  assert.equal(rootExp.parentId, null)
})

test('parseProjectView throws ORX_PARSE_FAILED on malformed input', () => {
  assert.throws(
    () => parseProjectView('just a random string'),
    (err) => err.code === 'ORX_PARSE_FAILED',
  )
})

test('parseRunsTable parses real runs.txt fixture', () => {
  const text = readFixture('runs.txt')
  const runs = parseRunsTable(text)
  assert.equal(runs.length, 1)
  assert.equal(runs[0].id, 'demo_nanochat_run_v1')
  assert.equal(runs[0].status, 'done')
  assert.equal(runs[0].experimentTitle, 'CPU Apple-Silicon end-to-end baseline')
  assert.equal(runs[0].commit, 'dae919e')
  assert.equal(runs[0].duration, '3h44m')
})

test('parseRunsTable returns empty array for empty or "no runs" table', () => {
  assert.deepEqual(parseRunsTable(''), [])
  assert.deepEqual(parseRunsTable('No runs found for project.'), [])
})

test('parseExperimentStatus parses real exp-status.txt fixture', () => {
  const text = readFixture('exp-status.txt')
  const status = parseExperimentStatus(text)
  assert.equal(status.id, 'demo_nanochat_cpu_v1')
  assert.equal(status.title, 'CPU Apple-Silicon end-to-end baseline')
  assert.equal(status.status, 'idle')
  assert.equal(status.isLocal, true)
  assert.equal(status.isRoot, true)
  assert.equal(status.parent, null)
  assert.equal(status.command, 'bash runs/runcpu.sh')
  assert.equal(status.commit, 'dae919e9b6f6edd3bdb14a514dd1e451781682f8')
  assert.equal(status.lastRun?.id, 'demo_nanochat_run_v1')
})

test('parseLogSummary parses real logs.txt fixture', () => {
  const text = readFixture('logs.txt')
  const summary = parseLogSummary(text)
  assert.equal(summary.path, '<repo>')
  assert.equal(summary.size, 1080323)
  assert.equal(summary.truncated, true)
  assert.match(summary.tail, /NanoChat Interactive Mode/)
})
