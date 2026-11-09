/**
 * Shared safety guards and validation for OpenResearch operations.
 * Used by both model-facing tools and HTTP endpoints.
 */
import { BILLED_BACKENDS, VALID_ID_REGEX } from '../shared/contracts.mjs'
import { OrxError } from '../shared/errors.mjs'

/**
 * Validate an identifier (project ID, experiment ID, run ID).
 * Throws OrxError with code BAD_REQUEST if invalid.
 *
 * @param {any} id
 * @param {string} [name='id']
 * @returns {string}
 */
export function validateId(id, name = 'id') {
  if (typeof id !== 'string' || !VALID_ID_REGEX.test(id.trim())) {
    throw new OrxError(
      'BAD_REQUEST',
      `Invalid ${name}: "${id}". Identifiers must match /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/`,
      'Verify the identifier and try again.',
    )
  }
  return id.trim()
}

/**
 * Check whether a compute launch requires cost confirmation.
 * Throws OrxError with code COST_CONFIRMATION_REQUIRED if paid backend is selected without confirmation.
 *
 * @param {string | undefined} backend
 * @param {boolean | undefined} confirmCost
 */
export function checkCostConfirmation(backend, confirmCost) {
  if (!backend) return
  const normalized = backend.trim().toLowerCase()
  if (BILLED_BACKENDS.includes(normalized) && confirmCost !== true) {
    throw new OrxError(
      'COST_CONFIRMATION_REQUIRED',
      `Launching on compute backend "${backend}" incurs monetary costs. Explicit confirmation required.`,
      'Pass confirmCost: true after confirming user intent, or choose backend: "local".',
    )
  }
}

/**
 * Check whether an experiment has a run currently in flight.
 * Throws OrxError with code RUN_IN_FLIGHT if active and not forced.
 *
 * @param {string} status
 * @param {boolean} [force=false]
 */
export function checkRunConcurrency(status, force = false) {
  const norm = (status || '').toLowerCase()
  if (norm === 'running' && !force) {
    throw new OrxError(
      'RUN_IN_FLIGHT',
      'Experiment already has a run in flight. Cannot launch concurrent runs without force: true.',
      'Wait for the active run to finish, cancel it with orx_run_cancel, or pass force: true if intentional.',
    )
  }
}
