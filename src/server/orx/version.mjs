/**
 * Version gate and parser for the orx CLI.
 */
import { runOrx } from './exec.mjs'

export const SUPPORTED_RANGE = {
  min: '0.2.19',
  maxExclusive: '0.3.0',
}

/**
 * Parse an orx version string (e.g. "orx 0.2.25", "0.2.19-rc.1").
 *
 * @param {string} str
 * @returns {{ raw: string, major: number, minor: number, patch: number, prerelease: string | null } | null}
 */
export function parseVersion(str) {
  if (typeof str !== 'string') return null
  const match = /(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(str.trim())
  if (!match) return null

  return {
    raw: match[0].trim(),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

/**
 * Compare two parsed semver versions.
 *
 * @param {object} a
 * @param {object} b
 * @returns {number} -1 if a < b, 1 if a > b, 0 if equal
 */
export function compareVersions(a, b) {
  const pa = typeof a === 'string' ? parseVersion(a) : a
  const pb = typeof b === 'string' ? parseVersion(b) : b
  if (!pa || !pb) throw new Error('Invalid version object to compare')

  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1

  // Handle prereleases: standard semver says 1.0.0-rc < 1.0.0
  if (pa.prerelease && !pb.prerelease) return -1
  if (!pa.prerelease && pb.prerelease) return 1
  if (pa.prerelease && pb.prerelease) {
    return pa.prerelease.localeCompare(pb.prerelease)
  }

  return 0
}

/**
 * Check if a version satisfies the supported range.
 *
 * @param {string | object} version
 * @param {{ min: string, maxExclusive: string }} [range=SUPPORTED_RANGE]
 * @returns {boolean}
 */
export function isSupported(version, range = SUPPORTED_RANGE) {
  const v = typeof version === 'string' ? parseVersion(version) : version
  if (!v) return false

  const minV = parseVersion(range.min)
  const maxV = parseVersion(range.maxExclusive)

  return compareVersions(v, minV) >= 0 && compareVersions(v, maxV) < 0
}

let cachedVersionPromise = null

/**
 * Query and cache the installed orx version.
 *
 * @param {Function} [execFn=runOrx]
 * @param {boolean} [forceRefresh=false]
 * @returns {Promise<{ raw: string, major: number, minor: number, patch: number, prerelease: string | null }>}
 */
export async function getOrxVersion(execFn = runOrx, forceRefresh = false) {
  if (!cachedVersionPromise || forceRefresh) {
    cachedVersionPromise = (async () => {
      const res = await execFn(['--version'])
      const parsed = parseVersion(res.stdout)
      if (!parsed) {
        const err = new Error(`Failed to parse orx version from output: "${res.stdout}"`)
        err.code = 'ORX_PARSE_FAILED'
        throw err
      }
      return parsed
    })()
  }
  return cachedVersionPromise
}

/**
 * Assert that the orx version is supported.
 *
 * @param {string | object} version
 * @param {object} [options={}]
 * @param {boolean} [options.allowUnsupportedOrx=false]
 * @param {{ min: string, maxExclusive: string }} [options.range=SUPPORTED_RANGE]
 * @returns {{ ok: boolean, warned: boolean, version: object }}
 */
export function assertSupported(version, options = {}) {
  const { allowUnsupportedOrx = false, range = SUPPORTED_RANGE } = options
  const v = typeof version === 'string' ? parseVersion(version) : version

  if (!v || !isSupported(v, range)) {
    if (allowUnsupportedOrx) {
      return { ok: false, warned: true, version: v }
    }
    const err = new Error(
      `orx version ${v?.raw ?? 'unknown'} is outside supported range [${range.min}, ${range.maxExclusive}). Upgrade orx or set allowUnsupportedOrx: true.`,
    )
    err.code = 'ORX_VERSION_UNSUPPORTED'
    err.version = v?.raw ?? null
    err.range = range
    throw err
  }

  return { ok: true, warned: false, version: v }
}
