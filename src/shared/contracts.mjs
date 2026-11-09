/**
 * Shared data contracts and constants for OpenResearch.
 */

/**
 * @typedef {object} Project
 * @property {string} id - Project UUID or identifier
 * @property {string} name - Human-readable project name
 * @property {string} path - Absolute local repository path
 * @property {string} baselineBranch - Name of baseline git branch (e.g. "main")
 */

/**
 * @typedef {object} Experiment
 * @property {string} id - Experiment identifier
 * @property {string} [projectId] - Owning project identifier
 * @property {string | null} parentId - Parent experiment ID (or null for root)
 * @property {string} title - Hypothesis or experiment title
 * @property {string} [description] - Extended description or notes
 * @property {string} branch - Git branch name
 * @property {string} [status] - Current lifecycle status (idle, running, done, failed)
 * @property {boolean} isRoot - True if this is the baseline root experiment
 * @property {string} [runCommand] - Fixed run command
 */

/**
 * @typedef {object} Run
 * @property {string} id - Run identifier
 * @property {string} [experimentId] - Associated experiment ID
 * @property {string} [experimentTitle] - Title of the experiment
 * @property {string} status - Execution status (done, running, failed, cancelled)
 * @property {string | null} commit - Short commit SHA
 * @property {string | null} duration - Formatted execution duration (e.g. "3h44m")
 * @property {string | null} updated - Relative update timestamp (e.g. "30d ago")
 */

/**
 * @typedef {object} LogSummary
 * @property {string} path - Path to log file
 * @property {number} size - File size in bytes
 * @property {string} tail - Recent log output
 * @property {boolean} truncated - True if output is a preview
 */

export const ROUTE_PREFIX = '/api/openresearch'

/** Compute backends that incur external monetary costs */
export const BILLED_BACKENDS = ['hf', 'modal', 'openresearch']

/** Supported compute backends */
export const SUPPORTED_BACKENDS = [
  'local',
  'ssh',
  'slurm',
  'k8s',
  'modal',
  'vercel',
  'hf',
  'openresearch',
  'tinker',
]

/** Strict identifier validation: alphanumeric leading, safe chars, max 128 chars */
export const VALID_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
