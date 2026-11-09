import assert from 'node:assert/strict'
import test from 'node:test'
import { createReadTools } from '../../src/server/tools/read.mjs'

test('orx_projects executes and renders markdown list', async () => {
  const mockClient = {
    listProjects: async () => [
      { id: 'p1', name: 'Demo Proj', path: '/path/p1', baselineBranch: 'main' },
    ],
  }

  const [projectsTool] = createReadTools({ client: mockClient })
  assert.equal(projectsTool.name, 'orx_projects')

  const res = await projectsTool.execute({})
  assert.equal(res.projects.length, 1)

  const rendered = projectsTool.output.render({}, res)
  assert.match(rendered[0].text, /Demo Proj/)
  assert.match(rendered[0].text, /branch: `main`/)
})

test('orx_tree executes viewProject and renders experiment tree', async () => {
  const mockClient = {
    viewProject: async (id, opts) => ({
      id,
      name: 'NanoChat',
      branch: 'main',
      command: 'bash run.sh',
      experiments: [
        { id: 'exp1', title: 'Baseline', isRoot: true, branch: 'orx/exp1', parentId: null },
      ],
    }),
  }

  const [, treeTool] = createReadTools({ client: mockClient })
  assert.equal(treeTool.name, 'orx_tree')

  const res = await treeTool.execute({ projectId: 'nanochat_1' })
  assert.equal(res.name, 'NanoChat')
  assert.equal(res.experiments[0].isRoot, true)

  const rendered = treeTool.output.render({ projectId: 'nanochat_1' }, res)
  assert.match(rendered[0].text, /🌱 \[root\]/)
  assert.match(rendered[0].text, /Baseline/)
})

test('orx_runs executes listRuns and renders markdown table', async () => {
  const mockClient = {
    listRuns: async (projectId, opts) => [
      {
        id: 'run_1',
        status: 'done',
        experimentTitle: 'Baseline',
        commit: 'abc1234',
        duration: '1h20m',
        updated: '2d ago',
      },
    ],
  }

  const [, , runsTool] = createReadTools({ client: mockClient })
  assert.equal(runsTool.name, 'orx_runs')

  const res = await runsTool.execute({ projectId: 'nanochat_1' })
  assert.equal(res.runs.length, 1)

  const rendered = runsTool.output.render({ projectId: 'nanochat_1' }, res)
  assert.match(rendered[0].text, /\| `run_1` \| \*\*done\*\* \|/)
})

test('orx_logs executes logSummary and renders formatted excerpt', async () => {
  const mockClient = {
    logSummary: async (runId) => ({
      path: '/path/run_1.log',
      size: 4096,
      tail: 'loss: 0.245\naccuracy: 94.2%',
      truncated: true,
    }),
  }

  const [, , , logsTool] = createReadTools({ client: mockClient })
  assert.equal(logsTool.name, 'orx_logs')

  const res = await logsTool.execute({ runId: 'run_1' })
  assert.equal(res.size, 4096)

  const rendered = logsTool.output.render({ runId: 'run_1' }, res)
  assert.match(rendered[0].text, /4096 bytes/)
  assert.match(rendered[0].text, /accuracy: 94\.2%/)
})
