/**
 * DeepSeek Harness bundle adapter for the OpenResearch method pack and research layer.
 *
 * 1. Mounts an isolated filesystem skill provider over skills/ so the OpenResearch
 *    research skills join the session catalog.
 * 2. If the host provides the tools service, registers the model-facing orx_* tools.
 * 3. If the host provides systemPrompt, injects the ambient research discipline section.
 *
 * Gracefully degrades to skills-only if runtime services are unavailable.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { apply as applyFilesystemProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { createAllTools } from './server/tools.mjs'
import { getPromptSectionTextSync, warmupProjectsCache } from './server/context.mjs'

const skillsRoot = fileURLToPath(new URL('../skills/', import.meta.url))

export const name = 'openresearch-skills'
export const inject = ['skills']

export function apply(ctx) {
  // 1. Isolated Skills Provider
  if (!existsSync(skillsRoot)) {
    ctx.logger?.warn?.(
      `dsh-openresearch: ${skillsRoot} is missing; run "node scripts/sync-skills.mjs".`,
    )
    return
  }

  applyFilesystemProvider(ctx, {
    providerName: 'openresearch',
    includeDefaultRoots: false,
    bundledSkillDir: skillsRoot,
    watch: false,
  })

  // 2. Optional Model-Facing Tools (Phase 1)
  if (typeof ctx.inject === 'function') {
    ctx.inject(['tools'], (pluginCtx) => {
      try {
        const tools = createAllTools()
        for (const tool of tools) {
          pluginCtx.tools?.register?.(tool)
        }
      } catch (err) {
        ctx.logger?.warn?.(`dsh-openresearch: tool registration failed: ${err.message}`)
      }
    })

    // 3. Optional Ambient Prompt Section
    ctx.inject(['systemPrompt'], (pluginCtx) => {
      try {
        warmupProjectsCache().catch(() => {})

        pluginCtx.effect?.(() => {
          return pluginCtx.systemPrompt?.section?.({
            name: 'openresearch-discipline',
            order: 1000,
            interpolate: false,
            text: (context) => {
              try {
                const cwd = context?.agent?.session
                  ? pluginCtx.workingDirectory?.get?.(context.agent.session) || process.cwd()
                  : process.cwd()
                return getPromptSectionTextSync(cwd) || ''
              } catch {
                return ''
              }
            },
          })
        })
      } catch (err) {
        ctx.logger?.warn?.(`dsh-openresearch: prompt section registration failed: ${err.message}`)
      }
    })

    // 4. Optional HTTP API routes (Phase 2)
    // registerApiRoutes(ctx)
  }
}
