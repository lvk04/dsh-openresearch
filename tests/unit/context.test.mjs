import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detectActiveProject,
  detectActiveProjectSync,
  getPromptSectionText,
  getPromptSectionTextSync,
  matchProject,
} from '../../src/server/context.mjs'

test('detectActiveProject matches project by directory prefix', async () => {
  const mockClient = {
    listProjects: async () => [
      { id: 'p1', name: 'Project One', path: 'D:/Projects/ai-paper', baselineBranch: 'main' },
      { id: 'p2', name: 'Project Two', path: 'D:/Projects/other', baselineBranch: 'main' },
    ],
  }

  const match = await detectActiveProject('D:/Projects/ai-paper/subfolder/test', mockClient)
  assert.equal(match?.id, 'p1')

  const noMatch = await detectActiveProject('D:/Unrelated/Workspace', mockClient)
  assert.equal(noMatch, null)
})

test('matchProject matches longest project path prefix', () => {
  const projects = [
    { id: 'p1', name: 'P1', path: 'D:/Projects/repo', baselineBranch: 'main' },
    { id: 'p2', name: 'P2', path: 'D:/Projects/repo/nested', baselineBranch: 'main' },
  ]
  const match = matchProject('D:/Projects/repo/nested/sub', projects)
  assert.equal(match?.id, 'p2')
})

test('detectActiveProjectSync matches project synchronously', () => {
  const projects = [
    { id: 'p1', name: 'Project One', path: 'D:/Projects/ai-paper', baselineBranch: 'main' },
  ]

  const match = detectActiveProjectSync('D:/Projects/ai-paper/file.py', projects)
  assert.equal(match?.id, 'p1')

  const noMatch = detectActiveProjectSync('D:/Unrelated/Dir', projects)
  assert.equal(noMatch, null)
})

test('getPromptSectionText returns null when outside project directory (zero tokens)', async () => {
  const mockClient = {
    listProjects: async () => [
      { id: 'p1', name: 'Project One', path: 'D:/Projects/ai-paper', baselineBranch: 'main' },
    ],
  }

  const text = await getPromptSectionText('D:/Not/Project', mockClient)
  assert.equal(text, null)
})

test('getPromptSectionText returns short under 8-line prompt when inside project', async () => {
  const mockClient = {
    listProjects: async () => [
      { id: 'p1', name: 'Project One', path: 'D:/Projects/ai-paper', baselineBranch: 'main' },
    ],
  }

  const text = await getPromptSectionText('D:/Projects/ai-paper', mockClient)
  assert.ok(text !== null)
  assert.match(text, /Project One/)
  assert.match(text, /Never edit a frozen experiment node/)

  const lineCount = text.split('\n').filter((l) => l.trim().length > 0).length
  assert.ok(lineCount <= 8, `Prompt section has ${lineCount} lines, expected <= 8`)
})

test('getPromptSectionTextSync returns empty string (never null or Promise) outside project', () => {
  const projects = [
    { id: 'p1', name: 'Project One', path: 'D:/Projects/ai-paper', baselineBranch: 'main' },
  ]

  const text = getPromptSectionTextSync('D:/Not/Project', projects)
  assert.equal(typeof text, 'string')
  assert.equal(text, '')
  // Must support indexOf without throwing
  assert.equal(typeof text.indexOf, 'function')
  assert.equal(text.indexOf('{{'), -1)
})

test('getPromptSectionTextSync returns discipline string inside project', () => {
  const projects = [
    { id: 'p1', name: 'Project One', path: 'D:/Projects/ai-paper', baselineBranch: 'main' },
  ]

  const text = getPromptSectionTextSync('D:/Projects/ai-paper', projects)
  assert.equal(typeof text, 'string')
  assert.match(text, /Project One/)
  assert.equal(typeof text.indexOf, 'function')
  assert.equal(text.indexOf('OpenResearch Project'), 0)
})
