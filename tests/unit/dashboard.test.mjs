import assert from 'node:assert/strict'
import test from 'node:test'
import { DataAdapter, probeDashboard } from '../../src/server/dashboard.mjs'

test('probeDashboard returns available: false when port is unreachable', async () => {
  // Use an unassigned port
  const res = await probeDashboard(59871, 100)
  assert.equal(res.available, false)
  assert.equal(res.port, 59871)
})

test('DataAdapter falls back to CLI when dashboard is offline', async () => {
  const mockClient = {
    listProjects: async () => [{ id: 'p1', name: 'CLI Proj', path: '/p1', baselineBranch: 'main' }],
    viewProject: async (id) => ({ id, name: 'CLI Tree', branch: 'main', experiments: [] }),
  }

  const adapter = new DataAdapter({
    client: mockClient,
    port: 59872, // offline port
    dataSource: 'auto',
  })

  const projects = await adapter.getProjects()
  assert.equal(projects.source, 'cli')
  assert.equal(projects.data[0].name, 'CLI Proj')

  const tree = await adapter.getTree('p1')
  assert.equal(tree.source, 'cli')
  assert.equal(tree.data.name, 'CLI Tree')
})

test('DataAdapter respects dataSource: "cli" override without probing', async () => {
  const mockClient = {
    listProjects: async () => [{ id: 'p1', name: 'Forced CLI', path: '/p1', baselineBranch: 'main' }],
  }

  const adapter = new DataAdapter({
    client: mockClient,
    port: 4791,
    dataSource: 'cli',
  })

  const projects = await adapter.getProjects()
  assert.equal(projects.source, 'cli')
  assert.equal(projects.data[0].name, 'Forced CLI')
})
