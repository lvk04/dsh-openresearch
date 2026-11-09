/**
 * Pure request handlers for OpenResearch HTTP routes.
 * Enforces standard JSON envelope: { ok: true, value } or { ok: false, error }.
 */
import { OrxClient } from './orx/client.mjs'
import { runDiagnostics } from './doctor.mjs'
import { validateId } from './guards.mjs'

const noStore = { 'cache-control': 'no-store' }

function jsonOk(value) {
  return Response.json({ ok: true, value }, { headers: noStore })
}

function jsonError(code, message, status = 400) {
  return Response.json({ ok: false, error: { code, message } }, { status, headers: noStore })
}

export async function handleGetStatus() {
  try {
    const diag = await runDiagnostics()
    return jsonOk(diag)
  } catch (err) {
    return jsonError('INTERNAL_ERROR', err.message, 500)
  }
}

export async function handleGetProjects(client = new OrxClient()) {
  try {
    const projects = await client.listProjects()
    return jsonOk(projects)
  } catch (err) {
    return jsonError(err.code || 'ORX_FAILED', err.message, 500)
  }
}

export async function handleGetTree(client = new OrxClient(), urlString = '') {
  try {
    const url = new URL(urlString, 'http://localhost')
    const projectId = url.searchParams.get('project') || url.searchParams.get('projectId')
    if (!projectId) {
      return jsonError('BAD_REQUEST', 'Missing required query parameter "project"')
    }

    validateId(projectId, 'projectId')
    const all = url.searchParams.get('all') === 'true'
    const view = await client.viewProject(projectId, { all })
    return jsonOk(view)
  } catch (err) {
    return jsonError(err.code || 'BAD_REQUEST', err.message, err.code === 'PROJECT_NOT_FOUND' ? 404 : 400)
  }
}

export async function handleGetRuns(client = new OrxClient(), urlString = '') {
  try {
    const url = new URL(urlString, 'http://localhost')
    const projectId = url.searchParams.get('project') || url.searchParams.get('projectId')
    if (!projectId) {
      return jsonError('BAD_REQUEST', 'Missing required query parameter "project"')
    }

    validateId(projectId, 'projectId')
    const experimentId = url.searchParams.get('experiment') || url.searchParams.get('experimentId')
    if (experimentId) validateId(experimentId, 'experimentId')

    const runs = await client.listRuns(projectId, { experimentId })
    return jsonOk(runs)
  } catch (err) {
    return jsonError(err.code || 'BAD_REQUEST', err.message, 400)
  }
}

export async function handleGetLogs(client = new OrxClient(), urlString = '') {
  try {
    const url = new URL(urlString, 'http://localhost')
    const runId = url.searchParams.get('run') || url.searchParams.get('runId')
    if (!runId) {
      return jsonError('BAD_REQUEST', 'Missing required query parameter "run"')
    }

    validateId(runId, 'runId')
    const summary = await client.logSummary(runId)
    return jsonOk(summary)
  } catch (err) {
    return jsonError(err.code || 'BAD_REQUEST', err.message, err.code === 'RUN_NOT_FOUND' ? 404 : 400)
  }
}
