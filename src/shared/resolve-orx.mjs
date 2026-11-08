/**
 * Pure resolver for the orx binary path and invocation target.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Resolve the orx binary path.
 *
 * Lookup order:
 * 1. env.ORX_BIN if provided and exists
 * 2. Directories in env.PATH (orx.exe, orx.cmd, orx on win32; orx on POSIX)
 * 3. On Windows: %LOCALAPPDATA%\Programs\OpenResearch\orx.exe
 * 4. On POSIX: $HOME/.local/bin/orx
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 * @param {NodeJS.Platform} [platform=process.platform]
 * @param {(path: string) => boolean} [exists=existsSync]
 * @returns {string | null}
 */
export function resolveOrx(env = process.env, platform = process.platform, exists = existsSync) {
  const explicit = env?.ORX_BIN
  if (explicit && exists(explicit)) return explicit

  const isWin = platform === 'win32'
  const p = isWin ? path.win32 : path.posix
  const names = isWin ? ['orx.exe', 'orx.cmd', 'orx'] : ['orx']

  const pathDelim = isWin ? ';' : ':'
  const pathDirs = (env?.PATH ?? '').split(pathDelim)
  for (const dir of pathDirs) {
    if (!dir) continue
    for (const name of names) {
      const candidate = p.join(dir, name)
      if (exists(candidate)) return candidate
    }
  }

  if (isWin) {
    if (env?.LOCALAPPDATA) {
      const installed = p.join(env.LOCALAPPDATA, 'Programs', 'OpenResearch', 'orx.exe')
      if (exists(installed)) return installed
    }
  } else {
    const home = env?.HOME
    if (home) {
      const candidate = p.join(home, '.local', 'bin', 'orx')
      if (exists(candidate)) return candidate
    }
  }

  return null
}

/**
 * Returns the invocation target for a resolved binary path.
 * On Windows, `.cmd` and `.bat` batch shims require cmd.exe to execute
 * without Node's CVE-2024-27980 EINVAL spawn errors.
 *
 * @param {string} binPath
 * @param {NodeJS.Platform} [platform=process.platform]
 * @returns {{ file: string, argsPrefix: string[], isBatch: boolean }}
 */
export function orxSpawnTarget(binPath, platform = process.platform) {
  const isWin = platform === 'win32'
  const isBatch = isWin && /\.(cmd|bat)$/i.test(binPath)
  if (isBatch) {
    return {
      file: process.env.ComSpec || 'cmd.exe',
      argsPrefix: ['/d', '/s', '/c'],
      isBatch: true,
    }
  }
  return {
    file: binPath,
    argsPrefix: [],
    isBatch: false,
  }
}
