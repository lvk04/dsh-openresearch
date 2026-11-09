/**
 * Model-facing read tools for OpenResearch.
 */
import { OrxClient } from '../orx/client.mjs'
import { defineTool } from './define.mjs'

/**
 * Create the model-facing read tools.
 *
 * @param {object} [options={}]
 * @param {OrxClient} [options.client]
 * @returns {Array<object>}
 */
export function createReadTools(options = {}) {
  const client = options.client ?? new OrxClient()

  const projectsTool = defineTool({
    name: 'orx_projects',
    description:
      'List all OpenResearch projects in the local store. Read orx-experiment-tree before creating or changing experiments.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        required: ['projects'],
        properties: {
          projects: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'name', 'path', 'baselineBranch'],
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                path: { type: 'string' },
                baselineBranch: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (!value?.projects || value.projects.length === 0) {
          return [{ type: 'text', text: 'No OpenResearch projects found in the local store.' }]
        }
        const text = value.projects
          .map((p) => `- **${p.name}** (\`${p.id}\`): \`${p.path}\` [branch: \`${p.baselineBranch}\`]`)
          .join('\n')
        return [{ type: 'text', text: `### OpenResearch Projects\n\n${text}` }]
      },
    },
    execute: async () => {
      const projects = await client.listProjects()
      return { projects }
    },
  })

  const treeTool = defineTool({
    name: 'orx_tree',
    description:
      'View the details, baseline command, and experiment tree hierarchy for an OpenResearch project. Read orx-experiment-tree before acting.',
    parameters: {
      projectId: {
        type: 'string',
        required: true,
        description: 'Project ID from orx_projects',
      },
      all: {
        type: 'boolean',
        description: 'Set to true to include archived experiments in the tree',
      },
    },
    output: {
      schema: {
        type: 'object',
        required: ['id', 'name', 'branch', 'experiments'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          repo: { type: 'string' },
          branch: { type: 'string' },
          command: { type: 'string' },
          experiments: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'title', 'branch', 'isRoot'],
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                isRoot: { type: 'boolean' },
                branch: { type: 'string' },
                parentId: { type: ['string', 'null'] },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const header =
          `### Project: **${value.name}** (\`${value.id}\`)\n` +
          `- Baseline Branch: \`${value.branch}\`\n` +
          `- Run Command: \`${value.command || '(inherited)'}\`\n\n` +
          `#### Experiment Tree\n`

        if (!value.experiments || value.experiments.length === 0) {
          return [{ type: 'text', text: header + '_No experiments found in this project._' }]
        }

        const expList = value.experiments
          .map(
            (e) =>
              `- ${e.isRoot ? '🌱 [root]' : '🌿'} **${e.title}** (\`${e.id}\` on branch \`${e.branch}\`)`,
          )
          .join('\n')

        return [{ type: 'text', text: header + expList }]
      },
    },
    execute: async (args) => {
      const view = await client.viewProject(args.projectId, { all: args.all })
      return view
    },
  })

  const runsTool = defineTool({
    name: 'orx_runs',
    description:
      'List execution runs for an OpenResearch project or experiment node, newest first. Read orx-logs before acting.',
    parameters: {
      projectId: {
        type: 'string',
        required: true,
        description: 'Project ID from orx_projects',
      },
      experimentId: {
        type: 'string',
        description: 'Optional experiment ID filter',
      },
    },
    output: {
      schema: {
        type: 'object',
        required: ['runs'],
        properties: {
          runs: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'status', 'experimentTitle'],
              properties: {
                id: { type: 'string' },
                status: { type: 'string' },
                experimentTitle: { type: 'string' },
                commit: { type: ['string', 'null'] },
                duration: { type: ['string', 'null'] },
                updated: { type: ['string', 'null'] },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (!value?.runs || value.runs.length === 0) {
          return [{ type: 'text', text: 'No runs recorded for this project.' }]
        }
        const rows = value.runs
          .map(
            (r) =>
              `| \`${r.id}\` | **${r.status}** | ${r.experimentTitle} | ${r.commit ?? '—'} | ${r.duration ?? '—'} | ${r.updated ?? '—'} |`,
          )
          .join('\n')

        const table =
          `| Run ID | Status | Experiment | Commit | Duration | Updated |\n` +
          `|---|---|---|---|---|---|\n` +
          rows
        return [{ type: 'text', text: table }]
      },
    },
    execute: async (args) => {
      const runs = await client.listRuns(args.projectId, {
        experimentId: args.experimentId,
      })
      return { runs }
    },
  })

  const logsTool = defineTool({
    name: 'orx_logs',
    description:
      'Inspect the persisted terminal output log path, byte size, and tail preview for an experiment run. Read orx-logs before acting.',
    parameters: {
      runId: {
        type: 'string',
        required: true,
        description: 'Run ID from orx_runs',
      },
    },
    output: {
      schema: {
        type: 'object',
        required: ['path', 'size', 'tail', 'truncated'],
        properties: {
          path: { type: 'string' },
          size: { type: 'number' },
          tail: { type: 'string' },
          truncated: { type: 'boolean' },
        },
      },
      render: (_args, value) => {
        const text =
          `Log file: \`${value.path}\` (${value.size} bytes)\n\n` +
          `\`\`\`text\n${value.tail || '(empty log)'}\n\`\`\`\n` +
          `_Use targeted search or tools to inspect specific lines if needed._`
        return [{ type: 'text', text }]
      },
    },
    execute: async (args) => {
      const summary = await client.logSummary(args.runId)
      return summary
    },
  })

  return [projectsTool, treeTool, runsTool, logsTool]
}
