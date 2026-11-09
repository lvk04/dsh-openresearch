import assert from 'node:assert/strict'
import test from 'node:test'
import { runDiagnostics, createDoctorTool } from '../../src/server/doctor.mjs'

test('runDiagnostics reports healthy when binary and store exist', async () => {
  const mockClient = {
    listProjects: async () => [{ id: 'p1', name: 'NanoChat', path: '/p1', baselineBranch: 'main' }],
  }

  const res = await runDiagnostics({
    client: mockClient,
    env: { PATH: 'C:\\Bin' },
    platform: 'win32',
  })

  assert.ok(Array.isArray(res.checks))
  assert.ok(res.checks.some((c) => c.id === 'binary'))
  assert.ok(res.checks.some((c) => c.id === 'store' && c.ok))
})

test('createDoctorTool executes and renders diagnostic report', async () => {
  const mockClient = {
    listProjects: async () => [{ id: 'p1', name: 'Demo', path: '/demo', baselineBranch: 'main' }],
  }

  const tool = createDoctorTool({ client: mockClient })
  assert.equal(tool.name, 'orx_doctor')

  const res = await tool.execute({})
  assert.ok(res.checks.length >= 3)

  const rendered = tool.output.render({}, res)
  assert.match(rendered[0].text, /Diagnostic Report/)
})
