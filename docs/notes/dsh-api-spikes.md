# DSH API Spikes and Runtime Discoveries (T0.6)

**Plan reference:** `docs/aegis/plans/2026-10-21-openresearch-research-layer.md` §6 (T0.6)  
**Host implementation:** DeepSeek Harness Desktop (`app.asar`)  
**Investigated against:** Installed runtime packages `@deepseek-ai/*` and active plugins (`dsh-context`, `dsh-hide-ui`).

---

## 1. Route Registration via Connection Service

### Mechanism
Server-side HTTP route registration is handled via the `connection` service (`@deepseek-ai/dsh-client-connection` / `@deepseek-ai/dsh-api-gateway`).

### Working Code Pattern
```javascript
export const name = 'openresearch-server'
export const inject = ['connection']

export function apply(ctx) {
  ctx.inject(['connection'], (ctx) => {
    const connection = ctx.get('connection')
    if (typeof connection?.fetch?.register !== 'function') return

    // Register route and tie its lifecycle to the Cordis context effect
    ctx.effect(() => {
      const unregister = connection.fetch.register({
        path: '/api/openresearch/projects',
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            const data = await getProjects()
            return Response.json(
              { ok: true, value: data },
              { headers: { 'cache-control': 'no-store' } }
            )
          } catch (error) {
            return Response.json(
              { ok: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message } },
              { status: 500, headers: { 'cache-control': 'no-store' } }
            )
          }
        },
      })
      return () => unregister?.()
    })
  })
}
```

- Handler receives a standard Web API `Request` object and returns a `Response` object.
- `requestBody: 'buffered'` parses incoming request bodies automatically.

---

## 2. Client Service Names and Component Injection

### Module Loader Pattern
The host web client resolves plugin client bundles from the `./client` package export (`src/client/index.js`). The file must wrap its execution inside `window.__ModuleLoader__.load`:

```javascript
window.__ModuleLoader__.load({
  id: 'dsh-openresearch',
  factory: (require) => {
    const React = require('react')
    const { createElement: h } = React

    return {
      name: 'dsh-openresearch',
      inject: ['slots', 'locale'],
      apply(ctx) {
        // Register locale dictionary
        ctx.effect(() => {
          return ctx.locale.register('openresearch', {
            en: {
              'tab.research': 'Research',
              'sidebar.guide': 'OpenResearch experiment tree and run manager',
            },
          })
        }, 'openresearch: locale')

        // Register right sidebar tab
        ctx.inject(['sidebarRightTabs'], (ctx) => {
          const tabs = ctx.sidebarRightTabs
          if (typeof tabs?.register !== 'function') return

          ctx.effect(() => {
            const unregisterTab = tabs.register({
              id: 'openresearch',
              kind: 'openresearch',
              title: () => ctx.locale.t('openresearch', 'tab.research'),
              guide: [
                {
                  order: 10,
                  title: () => ctx.locale.t('openresearch', 'tab.research'),
                  description: () => ctx.locale.t('openresearch', 'sidebar.guide'),
                },
              ],
            })

            const unregisterSlot = ctx.slots.inject('sidebar.right.pane.tab', () =>
              ctx.slots.register(
                { name: 'sidebar.right.pane.tab', key: 'openresearch', locale: 'openresearch' },
                (props) => h(ResearchPanel, { ...props, host: 'sidebar' })
              )
            )

            return () => {
              unregisterSlot?.()
              unregisterTab?.()
            }
          })
        })
      },
    }
  },
})
```

---

## 3. DSH Jobs Service

### Discovery
- DSH provides `@deepseek-ai/dsh-jobs` (abstract service `jobs`) implemented by `@deepseek-ai/dsh-jobs-local`.
- Methods available on `ctx.jobs`:
  - `start(spec)`: register and start a tracked job.
  - `list(caller)`: list active/finished jobs.
  - `get(id, caller)`: get status and output stream.
  - `kill(id, caller, reason)`: terminate a job.
  - `subscribe(ctx, filter, listener)`: observe status changes.
- Model tools `job_output`, `job_list`, and `job_kill` are provided by `@deepseek-ai/dsh-tool-jobs`.

### Recommendation for OpenResearch
For experiment run execution (`orx exp run`), the CLI returns immediately and runs asynchronously under `orx-host`. DSH jobs can wrap long-running foreground commands, or the server half can query `orx runs` directly, matching upstream's asynchronous completion model.

---

## 4. Client-to-Server Fetch and CORS

- **CORS Handling:** Not required. The DSH Web GUI runs on `http://127.0.0.1:19420` (or dynamic loopback port). Client calls to `fetch('/api/openresearch/...')` are same-origin.
- **Calling pattern:**
```javascript
const res = await fetch('api/openresearch/tree?project=' + encodeURIComponent(projectId))
const data = await res.json()
if (!data.ok) throw new Error(data.error?.message || 'Failed to fetch tree')
return data.value
```

---

## 5. Tool Approval, Pre-Execute Policy, and Risk Gates

### Tool Definition
```javascript
import { defineTool } from '@deepseek-ai/dsh-tools'

ctx.tools.register(
  defineTool({
    name: 'orx_experiment_create',
    description: 'Add a new experiment node to an OpenResearch project. Read orx-experiment-tree before creating.',
    parameters: {
      projectId: { type: 'string', required: true, description: 'Project ID' },
      title: { type: 'string', required: true, description: 'Experiment hypothesis/title' },
    },
    output: {
      schema: { type: 'object', required: ['id', 'title', 'branch'] },
      render: (args, res) => [{ type: 'text', text: `Created experiment ${res.id} on branch ${res.branch}` }],
    },
    execute: async (args, exec) => {
      // implementation
    },
  })
)
```

### Risk and Pre-Execute Waterfall
DSH runs `tools/pre-execute` waterfall:
```javascript
ctx.on('tools/pre-execute', async (exec, next) => {
  if (exec.tool.name === 'orx_experiment_run') {
    if (exec.args?.backend && exec.args.backend !== 'local' && !exec.args.confirmCost) {
      return {
        kind: 'ask',
        message: `Run requires non-local compute backend "${exec.args.backend}". Do you want to proceed?`,
      }
    }
  }
  return next()
})
```
- Return `{ kind: 'allow' }` to proceed immediately.
- Return `{ kind: 'ask', ... }` to trigger the harness user-approval dialog.
- Return `{ kind: 'reject', reason }` to deny execution.

---

## 6. Authentication and CSRF Protection

- Local routes registered via `connection.fetch.register` are bound to loopback and protected by the host's session connection token.
- Requests originating from the embedded Web GUI automatically carry the host session context. No manual CSRF tokens are required for plugin API routes.

---

## 7. Dashboard Detection and Sidecar Ownership

### Detection Probe
```javascript
export async function isDashboardRunning(port = 4791) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 600)
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'GET',
      signal: controller.signal,
    })
    clearTimeout(timer)
    return res.status === 200
  } catch {
    return false
  }
}
```

### Sidecar Ownership
When `manageDashboard: true`, spawn `orx up --no-browser --port <port>` via `child_process.spawn`. Keep the child PID and register a Cordis context disposal hook:
```javascript
ctx.effect(() => {
  return () => {
    if (sidecarChild?.pid) {
      killProcessTree(sidecarChild.pid)
    }
  }
})
```

---

## Conclusion

All 7 spike questions are answered with verified patterns from the host codebase and sibling plugins (`dsh-context`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-jobs`, `dsh-api-gateway`). **The gate for Phase 2 is satisfied.**
