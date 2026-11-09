/**
 * Pure formatters for OpenResearch client UI.
 */

/**
 * Format byte count into human-readable string.
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatByteSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const val = (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)
  return `${val} ${units[i]}`
}

/**
 * Return CSS color token for experiment or run status.
 *
 * @param {string} status
 * @returns {string} hex color
 */
export function statusColor(status) {
  switch ((status || '').toLowerCase()) {
    case 'done':
    case 'success':
      return '#10b981' // Green
    case 'running':
      return '#3b82f6' // Blue
    case 'failed':
    case 'error':
      return '#ef4444' // Red
    case 'cancelled':
    case 'stopping':
      return '#f59e0b' // Amber
    case 'idle':
    default:
      return '#94a3b8' // Slate
  }
}

/**
 * Normalize status text.
 *
 * @param {string} status
 * @returns {string}
 */
export function formatStatus(status) {
  if (!status) return 'Idle'
  const s = status.trim().toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}
