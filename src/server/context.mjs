/**
 * Ambient research discipline prompt section.
 * Zero-token cost for workspaces that are not OpenResearch projects.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { OrxClient } from './orx/client.mjs'

let DatabaseSync = null
try {
  const req = createRequire(import.meta.url)
  DatabaseSync = req('node:sqlite').DatabaseSync
} catch {
  // node:sqlite not supported in this environment
}

let cachedProjectsList = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 30000

/**
 * Match a directory against a list of projects.
 * Matches longest project path prefix.
 *
 * @param {string} cwd
 * @param {Array<import('../shared/contracts.mjs').Project>} projects
 * @returns {import('../shared/contracts.mjs').Project | null}
 */
export function matchProject(cwd, projects) {
  if (!cwd || !Array.isArray(projects) || projects.length === 0) return null
  const normalizedCwd = cwd.replace(/\\/g, '/').toLowerCase()

  let bestMatch = null
  for (const proj of projects) {
    if (!proj.path) continue
    const projPath = proj.path.replace(/\\/g, '/').toLowerCase()
    if (normalizedCwd === projPath || normalizedCwd.startsWith(projPath + '/')) {
      if (!bestMatch || projPath.length > bestMatch.path.length) {
        bestMatch = proj
      }
    }
  }
  return bestMatch
}

/**
 * Attempt to read local_projects directly and synchronously from orx.db.
 *
 * @returns {Array<import('../shared/contracts.mjs').Project> | null}
 */
export function getProjectsFromDbSync() {
  if (!DatabaseSync) return null
  const candidates = [
    'D:/Misc/sh/.local/share/openresearch/orx.db',
    join(process.env.USERPROFILE || process.env.HOME || '', '.local', 'share', 'openresearch', 'orx.db'),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const db = new DatabaseSync(candidate, { readOnly: true })
        const rows = db.prepare('SELECT id, name, repo_path, baseline_branch FROM local_projects').all()
        db.close()
        return rows.map((r) => ({
          id: r.id,
          name: r.name,
          path: r.repo_path,
          baselineBranch: r.baseline_branch,
        }))
      } catch {
        // Continue to next candidate
      }
    }
  }
  return null
}

/**
 * Warm up or refresh the in-memory projects cache in the background.
 *
 * @param {OrxClient} [client]
 * @returns {Promise<Array<import('../shared/contracts.mjs').Project>>}
 */
export async function warmupProjectsCache(client = new OrxClient()) {
  try {
    const projects = await client.listProjects()
    cachedProjectsList = projects
    cacheTimestamp = Date.now()
    return projects
  } catch {
    return cachedProjectsList || []
  }
}

/**
 * Synchronous project detection.
 * Checks in-memory cache, falls back to direct orx.db synchronous read.
 *
 * @param {string} [cwd=process.cwd()]
 * @param {Array<import('../shared/contracts.mjs').Project>} [projects]
 * @returns {import('../shared/contracts.mjs').Project | null}
 */
export function detectActiveProjectSync(cwd = process.cwd(), projects = null) {
  if (Array.isArray(projects)) {
    return matchProject(cwd, projects)
  }

  // 1. Check in-memory cache if fresh
  const now = Date.now()
  if (cachedProjectsList && now - cacheTimestamp < CACHE_TTL_MS) {
    return matchProject(cwd, cachedProjectsList)
  }

  // 2. Try synchronous sqlite read
  const dbProjects = getProjectsFromDbSync()
  if (dbProjects) {
    cachedProjectsList = dbProjects
    cacheTimestamp = now
    return matchProject(cwd, dbProjects)
  }

  // 3. Fallback to stale cache if present
  if (cachedProjectsList) {
    return matchProject(cwd, cachedProjectsList)
  }

  return null
}

/**
 * Format the discipline prompt section for a given project.
 *
 * @param {import('../shared/contracts.mjs').Project} project
 * @returns {string}
 */
export function formatPromptText(project) {
  return (
    `OpenResearch Project: "${project.name}" (ID: ${project.id})\n` +
    `1. Never edit a frozen experiment node once a run finishes; branch a child to test new hypotheses.\n` +
    `2. Run command and environment are fixed contracts across all nodes; vary code, not knobs.\n` +
    `3. Grow the experiment tree downward, descending on each round's winner.\n` +
    `4. Use native orx_* tools to inspect, create, and run experiments. Read relevant orx-* skills before acting.`
  )
}

/**
 * Generate the ambient prompt section text synchronously.
 * ALWAYS returns a string (empty string when outside project, never null, never Promise).
 *
 * @param {string} [cwd=process.cwd()]
 * @param {Array<import('../shared/contracts.mjs').Project>} [projects]
 * @returns {string}
 */
export function getPromptSectionTextSync(cwd = process.cwd(), projects = null) {
  const project = detectActiveProjectSync(cwd, projects)
  if (!project) return ''
  return formatPromptText(project)
}

/**
 * Detect whether a directory belongs to an OpenResearch project (async).
 *
 * @param {string} [cwd=process.cwd()]
 * @param {OrxClient} [client]
 * @returns {Promise<import('../shared/contracts.mjs').Project | null>}
 */
export async function detectActiveProject(cwd = process.cwd(), client = new OrxClient()) {
  try {
    const projects = await client.listProjects()
    cachedProjectsList = projects
    cacheTimestamp = Date.now()
    return matchProject(cwd, projects)
  } catch {
    return null
  }
}

/**
 * Generate the ambient prompt section text (async).
 * Strictly under 8 lines; returns null if not inside an active project.
 *
 * @param {string} [cwd=process.cwd()]
 * @param {OrxClient} [client]
 * @returns {Promise<string | null>}
 */
export async function getPromptSectionText(cwd = process.cwd(), client = new OrxClient()) {
  const project = await detectActiveProject(cwd, client)
  if (!project) return null
  return formatPromptText(project)
}
