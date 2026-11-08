/**
 * Pure parsers for orx CLI outputs.
 */
export { parseVersion } from './version.mjs'

function fail(msg, raw) {
  const err = new Error(msg)
  err.code = 'ORX_PARSE_FAILED'
  err.raw = raw
  throw err
}

/**
 * Parse output of `orx projects --json`.
 *
 * @param {string} jsonStr
 * @returns {Array<{ id: string, name: string, path: string, baselineBranch: string }>}
 */
export function parseProjectsJson(jsonStr) {
  if (typeof jsonStr !== 'string') fail('Projects JSON input must be a string', jsonStr)
  let data
  try {
    data = JSON.parse(jsonStr)
  } catch (e) {
    fail(`Malformed JSON in projects output: ${e.message}`, jsonStr)
  }

  if (!Array.isArray(data)) {
    fail('Projects JSON output must be an array', jsonStr)
  }

  return data.map((item, idx) => {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string') {
      fail(`Project entry at index ${idx} is missing required id or name`, jsonStr)
    }
    return {
      id: item.id,
      name: item.name,
      path: item.path ?? '',
      baselineBranch: item.baselineBranch ?? 'main',
    }
  })
}

/**
 * Parse human text output of `orx project view <projectId>`.
 *
 * @param {string} text
 * @returns {{ id: string, name: string, repo: string, branch: string, command: string, experiments: Array<{ id: string, title: string, isRoot: boolean, branch: string, parentId: null }> }}
 */
export function parseProjectView(text) {
  if (typeof text !== 'string' || !text.trim()) {
    fail('Project view text cannot be empty', text)
  }

  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const headerMatch = lines[0]?.match(/^(.+?)(?:\s+\((?:local|remote)\))?$/)
  if (!headerMatch) fail('Missing project header line', text)
  const name = headerMatch[1].trim()

  const idMatch = text.match(/^\s*id:\s*(\S+)/m)
  const repoMatch = text.match(/^\s*repo:\s*(.+)$/m)
  const branchMatch = text.match(/^\s*branch:\s*(\S+)(?:\s+\(baseline\))?/m)
  const cmdMatch = text.match(/^\s*command:\s*(.+)$/m)

  if (!idMatch) fail('Project view is missing id field', text)

  const experiments = []
  const expIdx = lines.findIndex((l) => /^\s*Experiments\s*$/i.test(l.trim()))
  if (expIdx !== -1) {
    for (let i = expIdx + 1; i < lines.length; i++) {
      const line = lines[i].trimEnd()
      if (!line.trim()) continue
      const match = line.match(/^\s+([A-Za-z0-9_.-]+)\s+(.+?)\s+\(([^)]+)\)$/)
      if (match) {
        const id = match[1]
        let title = match[2].trim()
        const isRoot = title.includes('[root]')
        title = title.replace(/\s*\[root\]\s*/g, '').trim()
        const branch = match[3].trim()
        experiments.push({
          id,
          title,
          isRoot,
          branch,
          parentId: null, // parent is null by design from project view
        })
      }
    }
  }

  return {
    id: idMatch[1].trim(),
    name,
    repo: repoMatch ? repoMatch[1].trim() : '',
    branch: branchMatch ? branchMatch[1].trim() : 'main',
    command: cmdMatch ? cmdMatch[1].trim() : '',
    experiments,
  }
}

/**
 * Parse output table of `orx runs <projectId>`.
 *
 * @param {string} text
 * @returns {Array<{ id: string, status: string, experimentTitle: string, commit: string | null, duration: string | null, updated: string | null }>}
 */
export function parseRunsTable(text) {
  if (typeof text !== 'string') fail('Runs text must be a string', text)
  const trimmed = text.trim()
  if (!trimmed || /no runs/i.test(trimmed)) return []

  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []

  // Check header
  const header = lines[0]
  if (!/ID\s+STATUS\s+EXPERIMENT/i.test(header)) {
    fail('Runs table is missing ID/STATUS/EXPERIMENT header', text)
  }

  // Find column separator line (─────)
  const sepIdx = lines.findIndex((l) => /^[─\- ]+$/.test(l))
  if (sepIdx === -1) fail('Runs table is missing separator line', text)

  // Use separator spans to determine column ranges
  const sepLine = lines[sepIdx]
  const colSpans = []
  const spanRegex = /[─\-]+/g
  let m
  while ((m = spanRegex.exec(sepLine)) !== null) {
    colSpans.push({ start: m.index, end: m.index + m[0].length })
  }

  const runs = []
  for (let i = sepIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue

    let id = ''
    let status = ''
    let experimentTitle = ''
    let commit = null
    let duration = null
    let updated = null

    if (colSpans.length >= 6) {
      id = line.slice(colSpans[0].start, colSpans[0].end).trim()
      status = line.slice(colSpans[1].start, colSpans[1].end).trim().toLowerCase()
      experimentTitle = line.slice(colSpans[2].start, colSpans[2].end).trim()
      commit = line.slice(colSpans[3].start, colSpans[3].end).trim() || null
      duration = line.slice(colSpans[4].start, colSpans[4].end).trim() || null
      updated = line.slice(colSpans[5].start).trim() || null
    } else {
      // Fallback whitespace tokenizer
      const parts = line.trim().split(/\s{2,}/)
      id = parts[0] ?? ''
      status = (parts[1] ?? '').toLowerCase()
      experimentTitle = parts[2] ?? ''
    }

    if (id) {
      runs.push({
        id,
        status,
        experimentTitle,
        commit,
        duration,
        updated,
      })
    }
  }

  return runs
}

/**
 * Parse output of `orx exp status <expId>`.
 *
 * @param {string} text
 * @returns {{ id: string, title: string, status: string, isLocal: boolean, branch: string, parent: string | null, isRoot: boolean, command: string, lastRun: { id: string, summary: string } | null, commit: string | null }}
 */
export function parseExperimentStatus(text) {
  if (typeof text !== 'string' || !text.trim()) {
    fail('Experiment status text cannot be empty', text)
  }

  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const firstLine = lines[0] ?? ''
  const titleMatch = firstLine.match(/^(.+?)(?:\s+\((\w+)\))?(?:\s+\[(\w+)\])?$/)
  const title = titleMatch ? titleMatch[1].trim() : firstLine.trim()
  const status = titleMatch?.[2]?.toLowerCase() ?? 'idle'
  const isLocal = titleMatch?.[3]?.toLowerCase() === 'local'

  const idMatch = text.match(/^\s*id:\s*(\S+)/m)
  const branchMatch = text.match(/^\s*branch:\s*(\S+)/m)
  const parentMatch = text.match(/^\s*parent:\s*(.+)$/m)
  const cmdMatch = text.match(/^\s*command:\s*(.+)$/m)
  const lastRunMatch = text.match(/^\s*last run:\s*([A-Za-z0-9_.-]+)(?:\s*\(([^)]+)\))?/m)
  const commitMatch = text.match(/^\s*commit:\s*([A-Fa-f0-9]+)/m)

  if (!idMatch) fail('Experiment status is missing id field', text)

  const parentRaw = parentMatch ? parentMatch[1].trim() : ''
  const isRoot = /root experiment/i.test(parentRaw) || parentRaw === '—'
  const parent = isRoot ? null : parentRaw

  let lastRun = null
  if (lastRunMatch) {
    lastRun = {
      id: lastRunMatch[1],
      summary: lastRunMatch[2] ? lastRunMatch[2].trim() : '',
    }
  }

  return {
    id: idMatch[1],
    title,
    status,
    isLocal,
    branch: branchMatch ? branchMatch[1] : '',
    parent,
    isRoot,
    command: cmdMatch ? cmdMatch[1].trim() : '',
    lastRun,
    commit: commitMatch ? commitMatch[1] : null,
  }
}

/**
 * Parse output of `orx logs <runId>`.
 *
 * @param {string} text
 * @returns {{ path: string, size: number, tail: string, truncated: boolean }}
 */
export function parseLogSummary(text) {
  if (typeof text !== 'string' || !text.trim()) {
    fail('Log summary text cannot be empty', text)
  }

  const pathMatch = text.match(/path to the full log file:\s*([^\r\n]+)/i)
  const sizeMatch = text.match(/is\s+(\d+)\s+bytes/i)

  if (!pathMatch) fail('Log summary is missing path field', text)
  const path = pathMatch[1].trim()
  const size = sizeMatch ? Number(sizeMatch[1]) : 0

  let tail = ''
  const tailHeaderMatch = text.match(/Here are the last \d+ characters of the log file:\s*\n/i)
  if (tailHeaderMatch && tailHeaderMatch.index !== undefined) {
    const fromTail = text.slice(tailHeaderMatch.index + tailHeaderMatch[0].length)
    const endMatch = fromTail.match(
      /(?:\n\s*run completed successfully|\n\s*Use targeted search on this path|\n\s*Avoid reading the entire log)/i,
    )
    tail = (endMatch ? fromTail.slice(0, endMatch.index) : fromTail).trimEnd()
  }

  return {
    path,
    size,
    tail,
    truncated: true,
  }
}
