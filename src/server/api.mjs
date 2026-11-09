/**
 * Server route registration for OpenResearch endpoints.
 */
import { OrxClient } from './orx/client.mjs'
import {
  handleGetStatus,
  handleGetProjects,
  handleGetTree,
  handleGetRuns,
  handleGetLogs,
} from './handlers.mjs'

/**
 * Register all OpenResearch HTTP API routes with the connection service.
 *
 * @param {object} ctx - Cordis plugin context
 * @param {object} [options={}]
 * @param {OrxClient} [options.client]
 */
export function registerApiRoutes(ctx, options = {}) {
  const client = options.client ?? new OrxClient()

  ctx.inject(['connection'], (pluginCtx) => {
    const connection = pluginCtx.get('connection')
    const registerFetch = connection?.fetch?.register
    if (typeof registerFetch !== 'function') return

    const routes = [
      {
        path: '/api/openresearch/status',
        methods: ['GET'],
        fetch: async () => handleGetStatus(),
      },
      {
        path: '/api/openresearch/projects',
        methods: ['GET'],
        fetch: async () => handleGetProjects(client),
      },
      {
        path: '/api/openresearch/tree',
        methods: ['GET'],
        fetch: async (req) => handleGetTree(client, req.url),
      },
      {
        path: '/api/openresearch/runs',
        methods: ['GET'],
        fetch: async (req) => handleGetRuns(client, req.url),
      },
      {
        path: '/api/openresearch/logs',
        methods: ['GET'],
        fetch: async (req) => handleGetLogs(client, req.url),
      },
    ]

    for (const route of routes) {
      pluginCtx.effect?.(() => {
        return registerFetch.call(connection.fetch, {
          path: route.path,
          methods: route.methods,
          requestBody: 'buffered',
          fetch: route.fetch,
        })
      })
    }
  })
}
