#!/usr/bin/env node
/**
 * Capture sanitized real CLI output fixtures for parser tests.
 *
 * Usage:
 *   node scripts/capture-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runOrx } from '../src/server/orx/exec.mjs'
import { parseVersion } from '../src/server/orx/version.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES_DIR = join(ROOT, 'tests', 'fixtures')

function sanitize(text) {
  return text
    .replace(/[A-Za-z]:\\[^ \r\n\t]+[\\/](openresearch-demo|nanochat|OpenResearch)[\\/][^ \r\n\t]*/gi, '<repo>')
    .replace(/[A-Za-z]:\\[^ \r\n\t]+[\\/]run-logs[\\/]([^ \r\n\t]+)/gi, '<logs>/$1')
    .replace(/[A-Za-z]:\\Users\\[^\\/\r\n\t]+/gi, '<home>')
    .replace(/\r\n/g, '\n')
}

async function main() {
  mkdirSync(FIXTURES_DIR, { recursive: true })

  // 1. Version
  const verRes = await runOrx(['--version'])
  const ver = parseVersion(verRes.stdout)
  if (!ver) throw new Error('Failed to parse orx version')
  writeFileSync(join(FIXTURES_DIR, 'VERSION'), `${ver.raw}\n`)
  console.log(`Captured VERSION: ${ver.raw}`)

  // 2. Projects JSON
  const projRes = await runOrx(['projects', '--json'])
  if (projRes.code !== 0) throw new Error(`orx projects --json failed: ${projRes.stderr}`)
  const rawProjects = JSON.parse(projRes.stdout)
  const demoProj = rawProjects.find((p) => p.id === 'demo_nanochat_v1') || rawProjects[0]
  if (!demoProj) throw new Error('No projects found to capture fixtures')

  // Keep a clean 2-project array for the fixture
  const sanitizedProjects = [demoProj].map((p) => ({
    ...p,
    path: '<repo>',
  }))
  writeFileSync(
    join(FIXTURES_DIR, 'projects.json'),
    `${JSON.stringify(sanitizedProjects, null, 2)}\n`,
  )
  console.log('Captured projects.json')

  const projectId = demoProj.id

  // 3. Project View
  const viewRes = await runOrx(['project', 'view', projectId])
  if (viewRes.code !== 0) throw new Error(`orx project view failed: ${viewRes.stderr}`)
  writeFileSync(join(FIXTURES_DIR, 'project-view.txt'), sanitize(viewRes.stdout))
  console.log('Captured project-view.txt')

  // 4. Runs Table
  const runsRes = await runOrx(['runs', projectId])
  if (runsRes.code !== 0) throw new Error(`orx runs failed: ${runsRes.stderr}`)
  writeFileSync(join(FIXTURES_DIR, 'runs.txt'), sanitize(runsRes.stdout))
  console.log('Captured runs.txt')

  // 5. Exp Status
  const expStatusRes = await runOrx(['exp', 'status', 'demo_nanochat_cpu_v1'])
  if (expStatusRes.code === 0) {
    writeFileSync(join(FIXTURES_DIR, 'exp-status.txt'), sanitize(expStatusRes.stdout))
    console.log('Captured exp-status.txt')
  }

  // 6. Logs
  const logRes = await runOrx(['logs', 'demo_nanochat_run_v1'])
  if (logRes.code === 0) {
    writeFileSync(join(FIXTURES_DIR, 'logs.txt'), sanitize(logRes.stdout))
    console.log('Captured logs.txt')
  }

  console.log('All fixtures captured successfully in tests/fixtures/.')
}

main().catch((err) => {
  console.error('Fixture capture failed:', err)
  process.exitCode = 1
})
