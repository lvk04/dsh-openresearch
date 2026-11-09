import assert from 'node:assert/strict'
import test from 'node:test'
import { createWriteTools } from '../../src/server/tools/write.mjs'

test('orx_experiment_create executes client.createExperiment and renders markdown', async () => {
  let createdArgs = null
  const mockClient = {
    createExperiment: async (projectId, title, opts) => {
      createdArgs = { projectId, title, ...opts }
      return { created: true, raw: 'Created experiment exp_2 on branch orx/exp-2' }
    },
  }

  const [createTool] = createWriteTools({ client: mockClient })
  assert.equal(createTool.name, 'orx_experiment_create')

  const res = await createTool.execute({
    projectId: 'demo_proj',
    title: 'Test Hypothesis',
    parentId: 'exp_1',
  })

  assert.equal(res.created, true)
  assert.equal(createdArgs.projectId, 'demo_proj')
  assert.equal(createdArgs.title, 'Test Hypothesis')
  assert.equal(createdArgs.parentId, 'exp_1')

  const rendered = createTool.output.render({ projectId: 'demo_proj', title: 'Test Hypothesis' }, res)
  assert.match(rendered[0].text, /Test Hypothesis/)
  assert.match(rendered[0].text, /demo_proj/)
})

test('orx_experiment_run invokes runExperiment and renders queue notice', async () => {
  let runArgs = null
  const mockClient = {
    runExperiment: async (experimentId, opts) => {
      runArgs = { experimentId, ...opts }
      return { started: true, raw: 'Run queued: demo_run_1' }
    },
  }

  const [, runTool] = createWriteTools({ client: mockClient })
  assert.equal(runTool.name, 'orx_experiment_run')

  const res = await runTool.execute({
    experimentId: 'exp_1',
    backend: 'local',
  })

  assert.equal(res.started, true)
  assert.equal(runArgs.experimentId, 'exp_1')
  assert.equal(runArgs.backend, 'local')

  const rendered = runTool.output.render({ experimentId: 'exp_1', backend: 'local' }, res)
  assert.match(rendered[0].text, /exp_1/)
  assert.match(rendered[0].text, /local/)
})

test('orx_run_cancel executes cancelRun and renders cancellation notice', async () => {
  let cancelledExp = null
  const mockClient = {
    cancelRun: async (experimentId) => {
      cancelledExp = experimentId
      return { cancelled: true, raw: 'Run cancelled' }
    },
  }

  const [, , cancelTool] = createWriteTools({ client: mockClient })
  assert.equal(cancelTool.name, 'orx_run_cancel')

  const res = await cancelTool.execute({ experimentId: 'exp_1' })
  assert.equal(res.cancelled, true)
  assert.equal(cancelledExp, 'exp_1')

  const rendered = cancelTool.output.render({ experimentId: 'exp_1' }, res)
  assert.match(rendered[0].text, /Cancellation Requested/)
  assert.match(rendered[0].text, /exp_1/)
})

test('orx_run_wait executes waitRun and renders completion notice', async () => {
  let waitedExp = null
  const mockClient = {
    waitRun: async (experimentId, opts) => {
      waitedExp = { experimentId, ...opts }
      return { raw: 'Run finished: done' }
    },
  }

  const [, , , waitTool] = createWriteTools({ client: mockClient })
  assert.equal(waitTool.name, 'orx_run_wait')

  const res = await waitTool.execute({ experimentId: 'exp_1', timeoutMs: 15000 })
  assert.equal(waitedExp.experimentId, 'exp_1')
  assert.equal(waitedExp.timeoutMs, 15000)

  const rendered = waitTool.output.render({ experimentId: 'exp_1' }, res)
  assert.match(rendered[0].text, /Wait Completed/)
})
