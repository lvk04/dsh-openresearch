/**
 * High-level programmatic client for OpenResearch CLI operations.
 */
import { OrxError } from '../../shared/errors.mjs'
import { runOrx } from './exec.mjs'
import {
  parseProjectsJson,
  parseProjectView,
  parseRunsTable,
  parseExperimentStatus,
  parseLogSummary,
} from './parse.mjs'
import { validateId, checkCostConfirmation, checkRunConcurrency } from '../guards.mjs'

let projectsCache = {
  data: null,
  timestamp: 0,
}

const CACHE_TTL_MS = 30000

/** Invalidate cached project list */
export function invalidateCache() {
  projectsCache = {
    data: null,
    timestamp: 0,
  }
}

/**
 * High-level client wrapping the orx CLI.
 */
export class OrxClient {
  /**
   * @param {object} [options={}]
   * @param {Function} [options.exec=runOrx]
   */
  constructor(options = {}) {
    this.exec = options.exec ?? runOrx
  }

  /**
   * List all projects in the local store.
   * Cached for 30s during read-only access.
   *
   * @param {object} [options={}]
   * @param {boolean} [options.force=false]
   * @returns {Promise<Array<import('../../shared/contracts.mjs').Project>>}
   */
  async listProjects(options = {}) {
    const now = Date.now()
    if (!options.force && projectsCache.data && now - projectsCache.timestamp < CACHE_TTL_MS) {
      return projectsCache.data
    }

    const res = await this.exec(['projects', '--json'])
    if (res.code !== 0) {
      throw new OrxError('ORX_FAILED', `Failed to list projects: ${res.stderr || res.stdout}`, null, res.code)
    }

    const projects = parseProjectsJson(res.stdout)
    projectsCache = {
      data: projects,
      timestamp: now,
    }
    return projects
  }

  /**
   * View details and experiment tree for one project.
   *
   * @param {string} projectId
   * @param {object} [options={}]
   * @param {boolean} [options.all=false]
   * @returns {Promise<object>}
   */
  async viewProject(projectId, options = {}) {
    const validId = validateId(projectId, 'projectId')
    const args = ['project', 'view', validId]
    if (options.all) args.push('--all')

    const res = await this.exec(args)
    if (res.code !== 0) {
      throw new OrxError(
        'PROJECT_NOT_FOUND',
        `Project "${validId}" not found or failed to load: ${res.stderr || res.stdout}`,
        'Verify the projectId using listProjects() and try again.',
        res.code,
      )
    }

    return parseProjectView(res.stdout)
  }

  /**
   * List execution runs for a project or experiment.
   *
   * @param {string} projectId
   * @param {object} [options={}]
   * @param {string} [options.experimentId]
   * @returns {Promise<Array<import('../../shared/contracts.mjs').Run>>}
   */
  async listRuns(projectId, options = {}) {
    const validProjectId = validateId(projectId, 'projectId')
    const args = ['runs', validProjectId]

    if (options.experimentId) {
      const validExpId = validateId(options.experimentId, 'experimentId')
      args.push('--experiment', validExpId)
    }

    const res = await this.exec(args)
    if (res.code !== 0) {
      throw new OrxError(
        'ORX_FAILED',
        `Failed to list runs for project "${validProjectId}": ${res.stderr || res.stdout}`,
        null,
        res.code,
      )
    }

    return parseRunsTable(res.stdout)
  }

  /**
   * Inspect status of one experiment node.
   *
   * @param {string} experimentId
   * @param {object} [options={}]
   * @param {boolean} [options.scheduler=false]
   * @returns {Promise<object>}
   */
  async experimentStatus(experimentId, options = {}) {
    const validExpId = validateId(experimentId, 'experimentId')
    const args = ['exp', 'status', validExpId]
    if (options.scheduler) args.push('--scheduler')

    const res = await this.exec(args)
    if (res.code !== 0) {
      throw new OrxError(
        'EXPERIMENT_NOT_FOUND',
        `Experiment "${validExpId}" not found: ${res.stderr || res.stdout}`,
        'Check the experimentId in the project tree.',
        res.code,
      )
    }

    return parseExperimentStatus(res.stdout)
  }

  /**
   * Get log summary and preview for one run.
   *
   * @param {string} runId
   * @returns {Promise<import('../../shared/contracts.mjs').LogSummary>}
   */
  async logSummary(runId) {
    const validRunId = validateId(runId, 'runId')
    const res = await this.exec(['logs', validRunId])
    if (res.code !== 0) {
      throw new OrxError(
        'RUN_NOT_FOUND',
        `Log for run "${validRunId}" not found: ${res.stderr || res.stdout}`,
        'Verify the runId using listRuns().',
        res.code,
      )
    }

    return parseLogSummary(res.stdout)
  }

  /**
   * Create a new child experiment node.
   * Immediately invalidates project cache.
   *
   * @param {string} projectId
   * @param {string} title
   * @param {object} [options={}]
   * @param {string} [options.parentId]
   * @param {string} [options.runCommand]
   * @param {boolean} [options.baseline=false]
   * @returns {Promise<{ created: boolean, raw: string }>}
   */
  async createExperiment(projectId, title, options = {}) {
    const validProjectId = validateId(projectId, 'projectId')
    if (typeof title !== 'string' || !title.trim()) {
      throw new OrxError('BAD_REQUEST', 'Experiment title is required.', 'Provide a descriptive hypothesis title.')
    }

    const args = ['create-experiment', validProjectId, '--title', title.trim()]
    if (options.parentId) {
      args.push('--parent', validateId(options.parentId, 'parentId'))
    }
    if (options.runCommand) {
      args.push('--run-command', options.runCommand)
    }
    if (options.baseline) {
      args.push('--baseline')
    }

    const res = await this.exec(args)
    invalidateCache()

    if (res.code !== 0) {
      throw new OrxError(
        'ORX_FAILED',
        `Failed to create experiment: ${res.stderr || res.stdout}`,
        null,
        res.code,
      )
    }

    return { created: true, raw: res.stdout }
  }

  /**
   * Launch an experiment run with safety and cost guards.
   * Immediately invalidates project cache.
   *
   * @param {string} experimentId
   * @param {object} [options={}]
   * @param {string} [options.backend]
   * @param {string} [options.flavor]
   * @param {string} [options.timeout]
   * @param {boolean} [options.force=false]
   * @param {boolean} [options.confirmCost=false]
   * @returns {Promise<{ started: boolean, raw: string }>}
   */
  async runExperiment(experimentId, options = {}) {
    const validExpId = validateId(experimentId, 'experimentId')

    // 1. Guard against unconfirmed billed backends
    checkCostConfirmation(options.backend, options.confirmCost)

    const args = ['exp', 'run', validExpId]
    if (options.backend) args.push('--backend', options.backend)
    if (options.flavor) args.push('--flavor', options.flavor)
    if (options.timeout) args.push('--timeout', options.timeout)
    if (options.force) args.push('--force')

    const res = await this.exec(args, { timeoutMs: 120000 })
    invalidateCache()

    if (res.code !== 0) {
      throw new OrxError(
        'ORX_FAILED',
        `Failed to launch run for experiment "${validExpId}": ${res.stderr || res.stdout}`,
        null,
        res.code,
      )
    }

    return { started: true, raw: res.stdout }
  }

  /**
   * Cancel an in-flight experiment run.
   * Immediately invalidates project cache.
   *
   * @param {string} experimentId
   * @returns {Promise<{ cancelled: boolean, raw: string }>}
   */
  async cancelRun(experimentId) {
    const validExpId = validateId(experimentId, 'experimentId')
    const res = await this.exec(['exp', 'cancel', validExpId])
    invalidateCache()

    if (res.code !== 0) {
      throw new OrxError(
        'ORX_FAILED',
        `Failed to cancel run for experiment "${validExpId}": ${res.stderr || res.stdout}`,
        null,
        res.code,
      )
    }

    return { cancelled: true, raw: res.stdout }
  }

  /**
   * Wait for an experiment run to complete.
   *
   * @param {string} experimentId
   * @param {object} [options={}]
   * @param {number} [options.timeoutMs=30000]
   * @returns {Promise<{ raw: string }>}
   */
  async waitRun(experimentId, options = {}) {
    const validExpId = validateId(experimentId, 'experimentId')
    const res = await this.exec(['exp', 'wait', validExpId], {
      timeoutMs: options.timeoutMs ?? 30000,
    })

    if (res.code !== 0) {
      throw new OrxError(
        'ORX_FAILED',
        `Wait command failed for experiment "${validExpId}": ${res.stderr || res.stdout}`,
        null,
        res.code,
      )
    }

    return { raw: res.stdout }
  }
}
