/**
 * Tool definition helper with graceful fallback for testing.
 */
let dshDefineTool = null

try {
  const mod = await import('@deepseek-ai/dsh-tools')
  dshDefineTool = mod.defineTool
} catch {
  // Standalone test environment fallback
}

export function defineTool(options) {
  if (typeof dshDefineTool === 'function') {
    return dshDefineTool(options)
  }
  return {
    name: options.name,
    description: options.description,
    parameters: options.parameters,
    output: options.output,
    execute: options.execute,
  }
}
