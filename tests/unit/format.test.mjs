import assert from 'node:assert/strict'
import test from 'node:test'
import { formatByteSize, statusColor, formatStatus } from '../../src/client/format.js'

test('formatByteSize formats byte values correctly', () => {
  assert.equal(formatByteSize(0), '0 B')
  assert.equal(formatByteSize(512), '512 B')
  assert.equal(formatByteSize(1024), '1.00 KB')
  assert.equal(formatByteSize(1080323), '1.03 MB')
})

test('statusColor assigns correct status colors', () => {
  assert.equal(statusColor('done'), '#10b981')
  assert.equal(statusColor('running'), '#3b82f6')
  assert.equal(statusColor('failed'), '#ef4444')
  assert.equal(statusColor('cancelled'), '#f59e0b')
  assert.equal(statusColor('idle'), '#94a3b8')
  assert.equal(statusColor('unknown'), '#94a3b8')
})

test('formatStatus capitalizes status words', () => {
  assert.equal(formatStatus('done'), 'Done')
  assert.equal(formatStatus('running'), 'Running')
  assert.equal(formatStatus(''), 'Idle')
})
