import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveOrx, orxSpawnTarget, dereferenceBatchTarget } from '../../src/shared/resolve-orx.mjs'

test('resolveOrx honors explicit ORX_BIN when it exists', () => {
  const env = { ORX_BIN: '/custom/bin/orx' }
  const exists = (p) => p === '/custom/bin/orx'
  assert.equal(resolveOrx(env, 'linux', exists), '/custom/bin/orx')
})

test('resolveOrx ignores explicit ORX_BIN when it does not exist', () => {
  const env = { ORX_BIN: '/missing/orx', PATH: '/usr/bin' }
  const exists = (p) => p === '/usr/bin/orx'
  assert.equal(resolveOrx(env, 'linux', exists), '/usr/bin/orx')
})

test('resolveOrx checks PATH on Linux', () => {
  const env = { PATH: '/opt/bin:/usr/local/bin:/usr/bin' }
  const exists = (p) => p === '/usr/local/bin/orx'
  assert.equal(resolveOrx(env, 'linux', exists), '/usr/local/bin/orx')
})

test('resolveOrx checks PATH candidates in order on Windows', () => {
  const env = { PATH: 'C:\\Tools;C:\\Bin' }
  // orx.cmd in C:\Bin vs orx.exe in C:\Bin
  const exists = (p) => p === 'C:\\Bin\\orx.cmd'
  assert.equal(resolveOrx(env, 'win32', exists), 'C:\\Bin\\orx.cmd')
})

test('resolveOrx falls back to LOCALAPPDATA on Windows', () => {
  const env = { PATH: '', LOCALAPPDATA: 'C:\\Users\\User\\AppData\\Local' }
  const target = 'C:\\Users\\User\\AppData\\Local\\Programs\\OpenResearch\\orx.exe'
  const exists = (p) => p === target
  assert.equal(resolveOrx(env, 'win32', exists), target)
})

test('resolveOrx falls back to ~/.local/bin/orx on POSIX', () => {
  const env = { PATH: '', HOME: '/home/user' }
  const target = '/home/user/.local/bin/orx'
  const exists = (p) => p === target
  assert.equal(resolveOrx(env, 'darwin', exists), target)
})

test('resolveOrx returns null when not found', () => {
  const env = { PATH: '/empty', HOME: '/home/none' }
  const exists = () => false
  assert.equal(resolveOrx(env, 'linux', exists), null)
})

test('orxSpawnTarget detects Windows batch files', () => {
  const target = orxSpawnTarget('C:\\Tools\\orx.cmd', 'win32')
  assert.equal(target.isBatch, true)
  assert.match(target.file, /cmd\.exe/i)
  assert.deepEqual(target.argsPrefix, ['/d', '/s', '/c'])
})

test('orxSpawnTarget passes through executables on Windows', () => {
  const target = orxSpawnTarget('C:\\Tools\\orx.exe', 'win32')
  assert.equal(target.isBatch, false)
  assert.equal(target.file, 'C:\\Tools\\orx.exe')
  assert.deepEqual(target.argsPrefix, [])
})

test('orxSpawnTarget passes through binaries on POSIX', () => {
  const target = orxSpawnTarget('/usr/local/bin/orx', 'linux')
  assert.equal(target.isBatch, false)
  assert.equal(target.file, '/usr/local/bin/orx')
  assert.deepEqual(target.argsPrefix, [])
})

test('dereferenceBatchTarget resolves .cmd shim to native .exe target', () => {
  const cmdPath = 'C:\\Users\\User\\.local\\bin\\orx.cmd'
  const exePath = 'C:\\Users\\User\\AppData\\Local\\Programs\\OpenResearch\\orx.exe'
  const exists = (p) => p === cmdPath || p === exePath
  const reader = (p) => `@echo off\r\n"${exePath}" %*\r\n`

  const dereferenced = dereferenceBatchTarget(cmdPath, 'win32', exists, reader)
  assert.equal(dereferenced, exePath)
})

test('dereferenceBatchTarget returns original path on non-batch or when target missing', () => {
  const exePath = 'C:\\Bin\\orx.exe'
  assert.equal(dereferenceBatchTarget(exePath, 'win32'), exePath)

  const cmdPath = 'C:\\Bin\\orx.cmd'
  const exists = (p) => p === cmdPath
  const reader = () => '@echo off\r\n"C:\\Missing\\orx.exe" %*\r\n'
  assert.equal(dereferenceBatchTarget(cmdPath, 'win32', exists, reader), cmdPath)
})
