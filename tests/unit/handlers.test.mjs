import assert from 'node:assert/strict'
import test from 'node:test'
import {
  handleGetStatus,
  handleGetProjects,
  handleGetTree,
  handleGetRuns,
  handleGetLogs,
} from '../../src/server/handlers.mjs'

test('handleGetProjects returns JSON envelope with projects', async () => {
  const mockClient = {
    listProjects: async () => [{ id: 'p1', name: 'Demo', path: '/repo', baselineBranch: 'main' }],
  }

  const res = await handleGetProjects(mockClient)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.value.length, 1)
  assert.equal(body.value[0].id, 'p1')
})

test('handleGetTree validates required project parameter', async () => {
  const mockClient = {}
  const res = await handleGetTree(mockClient, 'http://localhost/api/openresearch/tree')
  assert.equal(res.status, 400)
  const body = await res.json()
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'BAD_REQUEST')
})

test('handleGetTree returns tree for valid project', async () => {
  const mockClient = {
    viewProject: async (id) => ({
      id,
      name: 'NanoChat',
      branch: 'main',
      experiments: [{ id: 'exp1', title: 'Root', isRoot: true, branch: 'orx/root', parentId: null }],
    }),
  }

  const res = await handleGetTree(mockClient, 'http://localhost/api/openresearch/tree?project=p1')
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.value.id, 'p1')
  assert.equal(body.value.experiments.length, 1)
})

test('handleGetRuns returns runs for project', async () => {
  const mockClient = {
    listRuns: async (id) => [{ id: 'r1', status: 'done', experimentTitle: 'Exp' }],
  }

  const res = await handleGetRuns(mockClient, 'http://localhost/api/openresearch/runs?project=p1')
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.value[0].id, 'r1')
})

test('handleGetLogs returns log summary for run', async () => {
  const mockClient = {
    logSummary: async (runId) => ({ path: '/path/r1.log', size: 100, tail: 'done', truncated: false }),
  }

  const res = await handleGetLogs(mockClient, 'http://localhost/api/openresearch/logs?run=r1')
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.value.path, '/path/r1.log')
})
