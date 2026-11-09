/**
 * Aggregate model-facing tools registration for OpenResearch.
 */
import { createReadTools } from './tools/read.mjs'
import { createWriteTools } from './tools/write.mjs'
import { createDoctorTool } from './doctor.mjs'
import { OrxClient } from './orx/client.mjs'

/**
 * Create all model-facing OpenResearch tools.
 *
 * @param {object} [options={}]
 * @param {OrxClient} [options.client]
 * @returns {Array<object>}
 */
export function createAllTools(options = {}) {
  const client = options.client ?? new OrxClient()
  return [
    ...createReadTools({ client }),
    ...createWriteTools({ client }),
    createDoctorTool({ client }),
  ]
}
