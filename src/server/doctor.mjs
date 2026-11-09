/**
 * System diagnostic doctor tool for OpenResearch.
 */
import { resolveOrx } from '../shared/resolve-orx.mjs'
import { getOrxVersion, isSupported, SUPPORTED_RANGE } from './orx/version.mjs'
import { OrxClient } from './orx/client.mjs'
import { defineTool } from './tools/define.mjs'

export async function runDiagnostics(options = {}) {
  const client = options.client ?? new OrxClient()
  const checks = []

  // 1. Binary check
  const bin = resolveOrx(options.env, options.platform)
  if (bin) {
    checks.push({
      id: 'binary',
      title: 'orx CLI executable',
      ok: true,
      detail: `Found at ${bin}`,
      fix: null,
    })
  } else {
    checks.push({
      id: 'binary',
      title: 'orx CLI executable',
      ok: false,
      detail: 'orx binary not found on PATH, LOCALAPPDATA, or ~/.local/bin',
      fix: 'Install OpenResearch desktop/CLI or set $env:ORX_BIN',
    })
  }

  // 2. Version check
  if (bin) {
    try {
      const ver = await getOrxVersion()
      const supported = isSupported(ver)
      checks.push({
        id: 'version',
        title: 'orx version gate',
        ok: supported,
        detail: `Installed ${ver.raw} (supported range: [${SUPPORTED_RANGE.min}, ${SUPPORTED_RANGE.maxExclusive}))`,
        fix: supported ? null : 'Upgrade orx via "orx update"',
      })
    } catch (err) {
      checks.push({
        id: 'version',
        title: 'orx version gate',
        ok: false,
        detail: `Failed to query orx version: ${err.message}`,
        fix: 'Verify orx executable runs properly',
      })
    }
  }

  // 3. Project Store check
  try {
    const projects = await client.listProjects({ force: true })
    checks.push({
      id: 'store',
      title: 'OpenResearch local store',
      ok: true,
      detail: `Readable (${projects.length} project(s) registered)`,
      fix: null,
    })
  } catch (err) {
    checks.push({
      id: 'store',
      title: 'OpenResearch local store',
      ok: false,
      detail: `Store error: ${err.message}`,
      fix: 'Run "orx up" to initialize or inspect the local database',
    })
  }

  // 4. Dashboard loopback check
  try {
    const res = await fetch('http://127.0.0.1:4791/', {
      method: 'GET',
      signal: AbortSignal.timeout(600),
    })
    checks.push({
      id: 'dashboard',
      title: 'Local dashboard service (127.0.0.1:4791)',
      ok: res.status === 200,
      detail: res.status === 200 ? 'Active and responding on port 4791' : `HTTP ${res.status}`,
      fix: null,
    })
  } catch {
    checks.push({
      id: 'dashboard',
      title: 'Local dashboard service (127.0.0.1:4791)',
      ok: true, // Non-fatal, offline fallback is supported
      detail: 'Offline (CLI parsers active as primary fallback)',
      fix: 'Run "orx up" if live web UI / SSE tailing is desired',
    })
  }

  const healthy = checks.every((c) => c.ok)
  return { checks, healthy }
}

export function createDoctorTool(options = {}) {
  return defineTool({
    name: 'orx_doctor',
    description:
      'Run diagnostic health checks for the OpenResearch CLI, version compatibility, and project store.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        required: ['healthy', 'checks'],
        properties: {
          healthy: { type: 'boolean' },
          checks: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'title', 'ok', 'detail'],
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                ok: { type: 'boolean' },
                detail: { type: 'string' },
                fix: { type: ['string', 'null'] },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const rows = value.checks
          .map((c) => `- ${c.ok ? '✅' : '❌'} **${c.title}**: ${c.detail}${c.fix ? ` _(Fix: ${c.fix})_` : ''}`)
          .join('\n')

        const header = `### OpenResearch Diagnostic Report (${value.healthy ? 'Healthy' : 'Issues Found'})\n\n`
        return [{ type: 'text', text: header + rows }]
      },
    },
    execute: async () => {
      const res = await runDiagnostics(options)
      return res
    },
  })
}
