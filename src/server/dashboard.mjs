/**
 * Dual-source data adapter for OpenResearch.
 * Prefers rich dashboard HTTP API when live; falls back to CLI parsers when offline.
 */
import { OrxClient } from './orx/client.mjs'

/**
 * Probe whether the local orx up dashboard is running.
 *
 * @param {number} [port=4791]
 * @param {number} [timeoutMs=600]
 * @returns {Promise<{ available: boolean, port: number }>}
 */
export async function probeDashboard(port = 4791, timeoutMs = 600) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { available: res.status === 200, port }
  } catch {
    return { available: false, port }
  }
}

/**
 * Query a JSON endpoint on the local dashboard.
 *
 * @param {string} endpoint - e.g. "/api/projects"
 * @param {number} [port=4791]
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<any>}
 */
export async function fetchDashboardJson(endpoint, port = 4791, timeoutMs = 3000) {
  const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`Dashboard API HTTP ${res.status} on ${endpoint}`)
  return res.json()
}

/**
 * Dual-source adapter coordinating dashboard API and CLI fallbacks.
 */
export class DataAdapter {
  /**
   * @param {object} [options={}]
   * @param {OrxClient} [options.client]
   * @param {number} [options.port=4791]
   * @param {'auto' | 'api' | 'cli'} [options.dataSource='auto']
   */
  constructor(options = {}) {
    this.client = options.client ?? new OrxClient()
    this.port = options.port ?? 4791
    this.dataSource = options.dataSource ?? 'auto'
  }

  async getProjects() {
    if (this.dataSource !== 'cli') {
      try {
        const probe = await probeDashboard(this.port)
        if (probe.available) {
          const apiData = await fetchDashboardJson('/api/projects', this.port)
          if (Array.isArray(apiData)) {
            return {
              source: 'api',
              data: apiData.map((p) => ({
                id: p.id,
                name: p.name,
                path: p.path ?? '',
                baselineBranch: p.baselineBranch ?? 'main',
              })),
            }
          }
        }
      } catch {
        // Fall back to CLI
      }
    }

    const cliData = await this.client.listProjects()
    return { source: 'cli', data: cliData }
  }

  async getTree(projectId, all = false) {
    if (this.dataSource !== 'cli') {
      try {
        const probe = await probeDashboard(this.port)
        if (probe.available) {
          const apiData = await fetchDashboardJson(`/api/projects/${encodeURIComponent(projectId)}`, this.port)
          if (apiData && apiData.id) {
            return { source: 'api', data: apiData }
          }
        }
      } catch {
        // Fall back to CLI
      }
    }

    const cliData = await this.client.viewProject(projectId, { all })
    return { source: 'cli', data: cliData }
  }

  async getRuns(projectId, experimentId) {
    if (this.dataSource !== 'cli') {
      try {
        const probe = await probeDashboard(this.port)
        if (probe.available) {
          const endpoint = `/api/projects/${encodeURIComponent(projectId)}/runs`
          const apiData = await fetchDashboardJson(endpoint, this.port)
          if (Array.isArray(apiData)) {
            return { source: 'api', data: apiData }
          }
        }
      } catch {
        // Fall back to CLI
      }
    }

    const cliData = await this.client.listRuns(projectId, { experimentId })
    return { source: 'cli', data: cliData }
  }

  async getLogs(runId) {
    // Log files are always read directly from local run-logs storage
    const summary = await this.client.logSummary(runId)
    return { source: 'cli', data: summary }
  }
}
