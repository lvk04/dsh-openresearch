/**
 * Standard error taxonomy for OpenResearch operations.
 */

export class OrxError extends Error {
  /**
   * @param {string} code - Stable error code
   * @param {string} message - Human-readable error message
   * @param {string | null} [hint=null] - Actionable resolution hint for the caller
   * @param {number | null} [exitCode=null] - Process exit code if from CLI
   * @param {any} [details=null] - Additional error payload
   */
  constructor(code, message, hint = null, exitCode = null, details = null) {
    super(message)
    this.name = 'OrxError'
    this.code = code
    this.hint = hint
    this.exitCode = exitCode
    this.details = details
  }

  toJSON() {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        hint: this.hint,
        exitCode: this.exitCode,
        details: this.details,
      },
    }
  }
}

export function orxError(code, message, hint = null, exitCode = null, details = null) {
  return new OrxError(code, message, hint, exitCode, details)
}
