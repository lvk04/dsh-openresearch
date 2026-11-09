import assert from 'node:assert/strict'
import test from 'node:test'
import { validateId, checkCostConfirmation, checkRunConcurrency } from '../../src/server/guards.mjs'

test('validateId accepts safe alphanumeric identifiers', () => {
  assert.equal(validateId('demo_nanochat_v1'), 'demo_nanochat_v1')
  assert.equal(validateId('proj-123.4'), 'proj-123.4')
  assert.equal(validateId('dd15041b-eeab-4687-8027-2570bbe1b364'), 'dd15041b-eeab-4687-8027-2570bbe1b364')
})

test('validateId rejects invalid or malicious identifiers', () => {
  assert.throws(
    () => validateId('bad;command'),
    (err) => err.code === 'BAD_REQUEST',
  )
  assert.throws(
    () => validateId('../traversal'),
    (err) => err.code === 'BAD_REQUEST',
  )
  assert.throws(
    () => validateId('has spaces'),
    (err) => err.code === 'BAD_REQUEST',
  )
  assert.throws(
    () => validateId(''),
    (err) => err.code === 'BAD_REQUEST',
  )
  assert.throws(
    () => validateId(null),
    (err) => err.code === 'BAD_REQUEST',
  )
})

test('checkCostConfirmation permits local and non-billed backends without confirmation', () => {
  assert.doesNotThrow(() => checkCostConfirmation('local', false))
  assert.doesNotThrow(() => checkCostConfirmation('ssh', false))
  assert.doesNotThrow(() => checkCostConfirmation('slurm', false))
  assert.doesNotThrow(() => checkCostConfirmation(undefined, false))
})

test('checkCostConfirmation permits paid backends when confirmCost is true', () => {
  assert.doesNotThrow(() => checkCostConfirmation('hf', true))
  assert.doesNotThrow(() => checkCostConfirmation('modal', true))
  assert.doesNotThrow(() => checkCostConfirmation('openresearch', true))
})

test('checkCostConfirmation throws COST_CONFIRMATION_REQUIRED for paid backends without confirmation', () => {
  assert.throws(
    () => checkCostConfirmation('hf', false),
    (err) => err.code === 'COST_CONFIRMATION_REQUIRED',
  )
  assert.throws(
    () => checkCostConfirmation('modal', undefined),
    (err) => err.code === 'COST_CONFIRMATION_REQUIRED',
  )
  assert.throws(
    () => checkCostConfirmation('openresearch'),
    (err) => err.code === 'COST_CONFIRMATION_REQUIRED',
  )
})

test('checkRunConcurrency rejects when status is running and force is false', () => {
  assert.throws(
    () => checkRunConcurrency('running', false),
    (err) => err.code === 'RUN_IN_FLIGHT',
  )
  assert.doesNotThrow(() => checkRunConcurrency('running', true))
  assert.doesNotThrow(() => checkRunConcurrency('idle', false))
  assert.doesNotThrow(() => checkRunConcurrency('done', false))
})
