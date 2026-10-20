/**
 * DeepSeek Harness bundle adapter for the OpenResearch method pack.
 *
 * The host-owned filesystem skill provider stays the discovery implementation.
 * This adapter points one *isolated* provider at this package's generated
 * `skills/` tree, so the OpenResearch research skills join the session catalog
 * without re-scanning the project and user roots that the default provider
 * already owns.
 *
 * It deliberately adds no runtime authority: no tool replacement, no prompt
 * injection, no copied skill bodies. Every skill body is regenerated from the
 * installed `orx` binary by `scripts/sync-skills.mjs`, so the instructions the
 * model reads always match the CLI that will execute them.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { apply as applyFilesystemProvider } from '@deepseek-ai/dsh-skill-filesystem'

const skillsRoot = fileURLToPath(new URL('../skills/', import.meta.url))

export const name = 'openresearch-skills'
export const inject = ['skills']

export function apply(ctx) {
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
}
