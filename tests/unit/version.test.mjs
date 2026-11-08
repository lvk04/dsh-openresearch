import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseVersion,
  compareVersions,
  isSupported,
  assertSupported,
  getOrxVersion,
  SUPPORTED_RANGE,
} from '../../src/server/orx/version.mjs'

test('parseVersion extracts semver from orx output', () => {
  const p1 = parseVersion('orx 0.2.25\n')
  assert.deepEqual(p1, {
    raw: '0.2.25',
    major: 0,
    minor: 2,
    patch: 25,
    prerelease: null,
  })

  const p2 = parseVersion('0.2.19-canary.1')
  assert.deepEqual(p2, {
    raw: '0.2.19-canary.1',
    major: 0,
    minor: 2,
    patch: 19,
    prerelease: 'canary.1',
  })

  assert.equal(parseVersion('invalid'), null)
  assert.equal(parseVersion(''), null)
  assert.equal(parseVersion(null), null)
})

test('compareVersions orders versions correctly', () => {
  assert.equal(compareVersions('0.2.19', '0.2.25'), -1)
  assert.equal(compareVersions('0.2.25', '0.2.19'), 1)
  assert.equal(compareVersions('0.2.25', '0.2.25'), 0)
  assert.equal(compareVersions('0.3.0', '0.2.25'), 1)
  assert.equal(compareVersions('0.2.19-rc.1', '0.2.19'), -1)
})

test('isSupported validates against range [0.2.19, 0.3.0)', () => {
  assert.equal(isSupported('0.2.18'), false)
  assert.equal(isSupported('0.2.19'), true)
  assert.equal(isSupported('0.2.25'), true)
  assert.equal(isSupported('0.3.0'), false)
  assert.equal(isSupported('1.0.0'), false)
})

test('assertSupported passes within range and throws outside', () => {
  const ok = assertSupported('0.2.25')
  assert.equal(ok.ok, true)
  assert.equal(ok.warned, false)

  assert.throws(
    () => assertSupported('0.2.18'),
    (err) => err.code === 'ORX_VERSION_UNSUPPORTED',
  )

  assert.throws(
    () => assertSupported('0.3.1'),
    (err) => err.code === 'ORX_VERSION_UNSUPPORTED',
  )

  const bypassed = assertSupported('0.3.1', { allowUnsupportedOrx: true })
  assert.equal(bypassed.ok, false)
  assert.equal(bypassed.warned, true)
})

test('getOrxVersion parses stdout from execFn and caches', async () => {
  let callCount = 0
  const mockExec = async () => {
    callCount++
    return { stdout: 'orx 0.2.25\n', stderr: '', code: 0 }
  }

  const v1 = await getOrxVersion(mockExec, true)
  assert.equal(v1.raw, '0.2.25')
  assert.equal(callCount, 1)

  const v2 = await getOrxVersion(mockExec, false)
  assert.equal(v2.raw, '0.2.25')
  assert.equal(callCount, 1) // cached
})
