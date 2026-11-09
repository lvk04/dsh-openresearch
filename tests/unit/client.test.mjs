import assert from 'node:assert/strict'
import test from 'node:test'
import { OrxClient, invalidateCache } from '../../src/server/orx/client.mjs'

test('OrxClient.listProjects caches responses and respects invalidateCache', async () => {
  let callCount = 0
  const mockExec = async (args) => {
    callCount++
    assert.deepEqual(args, ['projects', '--json'])
    return {
      code: 0,
      stdout: JSON.stringify([{ id: 'p1', name: 'Proj 1', path: '/repo', baselineBranch: 'main' }]),
      stderr: '',
    }
  }

  const client = new OrxClient({ exec: mockExec })
  invalidateCache()

  const p1 = await client.listProjects()
  assert.equal(p1.length, 1)
  assert.equal(callCount, 1)

  // Second call within TTL hits cache
  const p2 = await client.listProjects()
  assert.equal(p2.length, 1)
  assert.equal(callCount, 1)

  // Invalidate cache triggers fresh call
  invalidateCache()
  const p3 = await client.listProjects()
  assert.equal(p3.length, 1)
  assert.equal(callCount, 2)
})

test('OrxClient.viewProject validates ID and passes arguments', async () => {
  let executedArgs = null
  const mockExec = async (args) => {
    executedArgs = args
    return {
      code: 0,
      stdout:
        'demo_nanochat (local)\n  id: demo_nanochat\n  repo: /repo\n  branch: main\n  command: run.sh\n\nExperiments\n  exp1  First test  (branch-1)\n',
      stderr: '',
    }
  }

  const client = new OrxClient({ exec: mockExec })
  const res = await client.viewProject('demo_nanochat', { all: true })
  assert.equal(res.id, 'demo_nanochat')
  assert.deepEqual(executedArgs, ['project', 'view', 'demo_nanochat', '--all'])

  // Rejects invalid ID without executing
  await assert.rejects(
    async () => client.viewProject('bad/id'),
    (err) => err.code === 'BAD_REQUEST',
  )
})

test('OrxClient.createExperiment invalidates projects cache', async () => {
  let created = false
  const mockExec = async (args) => {
    if (args[0] === 'projects') {
      return {
        code: 0,
        stdout: JSON.stringify([{ id: 'p1', name: created ? 'After' : 'Before', path: '/repo', baselineBranch: 'main' }]),
        stderr: '',
      }
    }
    if (args[0] === 'create-experiment') {
      created = true
      return { code: 0, stdout: 'Created experiment exp2 on branch orx/exp2\n', stderr: '' }
    }
    throw new Error('Unexpected command: ' + args)
  }

  const client = new OrxClient({ exec: mockExec })
  invalidateCache()

  const before = await client.listProjects()
  assert.equal(before[0].name, 'Before')

  // Creating an experiment must invalidate the cache immediately
  await client.createExperiment('p1', 'New Hypothesis', { parentId: 'exp1' })

  const after = await client.listProjects()
  assert.equal(after[0].name, 'After')
})

test('OrxClient.runExperiment enforces cost confirmation before calling exec', async () => {
  let executed = false
  const mockExec = async () => {
    executed = true
    return { code: 0, stdout: 'queued', stderr: '' }
  }

  const client = new OrxClient({ exec: mockExec })

  // Refuses paid backend without confirmCost
  await assert.rejects(
    async () => client.runExperiment('exp1', { backend: 'hf', confirmCost: false }),
    (err) => err.code === 'COST_CONFIRMATION_REQUIRED',
  )
  assert.equal(executed, false)

  // Accepts with confirmCost: true
  const res = await client.runExperiment('exp1', { backend: 'hf', confirmCost: true })
  assert.equal(res.started, true)
  assert.equal(executed, true)
})
