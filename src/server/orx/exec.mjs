/**
 * Low-level execution wrapper for the orx CLI.
 */
import { spawn } from 'node:child_process'
import { resolveOrx, orxSpawnTarget, dereferenceBatchTarget } from '../../shared/resolve-orx.mjs'

const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

export const stripAnsi = (str) => (str ? str.replace(ANSI_REGEX, '') : '')
export const normalizeOutput = (str) => stripAnsi(str.replace(/\r\n/g, '\n'))

const quoteCmdArg = (v) => `"${String(v).replace(/"/g, '""')}"`

/**
 * Run an orx CLI command.
 *
 * @param {string[]} [args=[]]
 * @param {object} [options={}]
 * @param {string} [options.cwd=process.cwd()]
 * @param {number} [options.timeoutMs=15000]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.maxBytes=5242880]
 * @param {Record<string, string | undefined>} [options.env=process.env]
 * @param {string} [options.binPath]
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
export async function runOrx(args = [], options = {}) {
  const {
    cwd = process.cwd(),
    timeoutMs = 15000,
    signal,
    maxBytes = 5 * 1024 * 1024,
    env = process.env,
    binPath,
  } = options

  const rawBin = binPath ?? resolveOrx(env)
  if (!rawBin) {
    const err = new Error('orx binary not found')
    err.code = 'ORX_MISSING'
    throw err
  }

  const bin = dereferenceBatchTarget(rawBin)
  const target = orxSpawnTarget(bin)
  const cmd = target.file
  let spawnArgs = []

  if (target.isBatch) {
    const cmdLine = [quoteCmdArg(bin), ...args.map(quoteCmdArg)].join(' ')
    // cmd.exe /s /c strips the first and last quote if the command starts with a quote,
    // so wrap the entire command line in an outer quote pair to protect inner quotes.
    spawnArgs = [...target.argsPrefix, `"${cmdLine}"`]
  } else {
    spawnArgs = [...args]
  }

  return new Promise((resolve, reject) => {
    let stdoutBuffer = ''
    let stderrBuffer = ''
    let settled = false
    let timer = null

    const child = spawn(cmd, spawnArgs, {
      cwd,
      env,
      windowsHide: true,
      windowsVerbatimArguments: target.isBatch,
      signal,
    })

    const killTree = () => {
      settled = true
      if (process.platform === 'win32' && child.pid) {
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          })
        } catch {
          child.kill('SIGTERM')
        }
      } else {
        child.kill('SIGTERM')
      }
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        killTree()
        const err = new Error(`orx command timed out after ${timeoutMs}ms`)
        err.code = 'ETIMEDOUT'
        reject(err)
      }, timeoutMs)
    }

    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          killTree()
          const err = new Error('orx command aborted')
          err.code = 'ABORT_ERR'
          reject(err)
        },
        { once: true },
      )
    }

    child.stdout?.on('data', (chunk) => {
      if (Buffer.byteLength(stdoutBuffer, 'utf8') < maxBytes) {
        stdoutBuffer += chunk.toString('utf8')
      }
    })

    child.stderr?.on('data', (chunk) => {
      if (Buffer.byteLength(stderrBuffer, 'utf8') < maxBytes) {
        stderrBuffer += chunk.toString('utf8')
      }
    })

    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      if (!settled) {
        settled = true
        reject(err)
      }
    })

    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (!settled) {
        settled = true
        resolve({
          code: code ?? 0,
          stdout: normalizeOutput(stdoutBuffer),
          stderr: normalizeOutput(stderrBuffer),
        })
      }
    })
  })
}
