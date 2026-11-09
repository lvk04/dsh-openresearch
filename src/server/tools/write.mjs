/**
 * Model-facing write tools for OpenResearch.
 */
import { OrxClient } from '../orx/client.mjs'
import { defineTool } from './define.mjs'

/**
 * Create the model-facing write tools.
 *
 * @param {object} [options={}]
 * @param {OrxClient} [options.client]
 * @returns {Array<object>}
 */
export function createWriteTools(options = {}) {
  const client = options.client ?? new OrxClient()

  const createTool = defineTool({
    name: 'orx_experiment_create',
    description:
      'Add a new experiment node to an OpenResearch project. Cardinal rule: always read orx-experiment-tree before adding nodes.',
    parameters: {
      projectId: {
        type: 'string',
        required: true,
        description: 'Project ID from orx_projects',
      },
      title: {
        type: 'string',
        required: true,
        description: 'Descriptive hypothesis or variant title',
      },
      parentId: {
        type: 'string',
        description: 'Parent experiment ID to branch from (defaults to baseline/root)',
      },
      runCommand: {
        type: 'string',
        description:
          'Run command override (rarely used; contract dictates identical command across nodes)',
      },
      baseline: {
        type: 'boolean',
        description: 'Set to true only if establishing a new baseline',
      },
    },
    output: {
      schema: {
        type: 'object',
        required: ['created'],
        properties: {
          created: { type: 'boolean' },
          raw: { type: 'string' },
        },
      },
      render: (args, value) => {
        const text =
          `### Experiment Node Created\n\n` +
          `- **Title:** ${args.title}\n` +
          `- **Project ID:** \`${args.projectId}\`\n` +
          (args.parentId ? `- **Parent ID:** \`${args.parentId}\`\n` : '- **Branching from:** Baseline root\n') +
          `\n\`\`\`\n${value.raw?.trim() || 'Node created successfully'}\n\`\`\``
        return [{ type: 'text', text }]
      },
    },
    execute: async (args) => {
      const res = await client.createExperiment(args.projectId, args.title, {
        parentId: args.parentId,
        runCommand: args.runCommand,
        baseline: args.baseline,
      })
      return res
    },
  })

  const runTool = defineTool({
    name: 'orx_experiment_run',
    description:
      'Launch an experiment run in OpenResearch. Enforces cost guards for paid cloud backends. Read orx-compute before launching.',
    parameters: {
      experimentId: {
        type: 'string',
        required: true,
        description: 'Experiment node ID to run',
      },
      backend: {
        type: 'string',
        description:
          'Compute backend (local, ssh, slurm, k8s, modal, vercel, hf, openresearch). Defaults to local or machine config.',
      },
      flavor: {
        type: 'string',
        description: 'Hardware flavor/size for supported cloud backends',
      },
      timeout: {
        type: 'string',
        description: 'Execution timeout string (e.g. "30m", "2h")',
      },
      confirmCost: {
        type: 'boolean',
        description:
          'Must be explicitly set to true when launching on paid cloud backends (hf, modal, openresearch)',
      },
      force: {
        type: 'boolean',
        description: 'Force launch even if node already ran or has a run in flight',
      },
    },
    output: {
      schema: {
        type: 'object',
        required: ['started'],
        properties: {
          started: { type: 'boolean' },
          raw: { type: 'string' },
        },
      },
      render: (args, value) => {
        const text =
          `### Experiment Run Queued\n\n` +
          `- **Experiment ID:** \`${args.experimentId}\`\n` +
          `- **Backend:** \`${args.backend || 'default'}\`\n` +
          `\n\`\`\`\n${value.raw?.trim() || 'Run queued successfully'}\n\`\`\``
        return [{ type: 'text', text }]
      },
    },
    execute: async (args) => {
      const res = await client.runExperiment(args.experimentId, {
        backend: args.backend,
        flavor: args.flavor,
        timeout: args.timeout,
        confirmCost: args.confirmCost,
        force: args.force,
      })
      return res
    },
  })

  const cancelTool = defineTool({
    name: 'orx_run_cancel',
    description:
      'Request cancellation of an active experiment run. Read orx-compute before cancelling.',
    parameters: {
      experimentId: {
        type: 'string',
        required: true,
        description: 'Experiment node ID whose active run should be cancelled',
      },
    },
    output: {
      schema: {
        type: 'object',
        required: ['cancelled'],
        properties: {
          cancelled: { type: 'boolean' },
          raw: { type: 'string' },
        },
      },
      render: (args, value) => {
        const text =
          `### Run Cancellation Requested\n\n` +
          `- **Experiment ID:** \`${args.experimentId}\`\n` +
          `\n\`\`\`\n${value.raw?.trim() || 'Cancellation requested'}\n\`\`\``
        return [{ type: 'text', text }]
      },
    },
    execute: async (args) => {
      const res = await client.cancelRun(args.experimentId)
      return res
    },
  })

  const waitTool = defineTool({
    name: 'orx_run_wait',
    description:
      'Wait for an experiment run to complete, bounded by a timeout. Read orx-experiment-tree before waiting.',
    parameters: {
      experimentId: {
        type: 'string',
        required: true,
        description: 'Experiment node ID to wait for',
      },
      timeoutMs: {
        type: 'number',
        description: 'Maximum time to wait in milliseconds (default: 30000)',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          raw: { type: 'string' },
        },
      },
      render: (args, value) => {
        const text =
          `### Run Wait Completed\n\n` +
          `- **Experiment ID:** \`${args.experimentId}\`\n` +
          `\n\`\`\`\n${value.raw?.trim() || 'Wait completed'}\n\`\`\``
        return [{ type: 'text', text }]
      },
    },
    execute: async (args) => {
      const res = await client.waitRun(args.experimentId, {
        timeoutMs: args.timeoutMs,
      })
      return res
    },
  })

  return [createTool, runTool, cancelTool, waitTool]
}
