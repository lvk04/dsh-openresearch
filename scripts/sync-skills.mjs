#!/usr/bin/env node
/**
 * Regenerate `skills/` from the locally installed `orx` binary.
 *
 * Why generate instead of hand-authoring: OpenResearch ships its agent skills
 * *inside* the CLI. `orx skill` prints the overview playbook and
 * `orx skill <name>` prints one module, each already carrying the
 * `name`/`description` frontmatter a DeepSeek Harness skill needs. Reading them
 * from the installed binary therefore keeps the pack exactly matched to the CLI
 * version that will actually run the commands — no hand-transcription drift.
 *
 * Lazily loaded module resources (e.g. `compute/hf`) are deliberately NOT
 * vendored: the CLI serves them on demand (`orx skill compute/hf`), so the CLI
 * stays the single source of truth for them.
 *
 * Usage:
 *   node scripts/sync-skills.mjs          # write skills/
 *   node scripts/sync-skills.mjs --check  # exit 1 if skills/ is stale
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = join(ROOT, 'skills')
const AUTHORED_DIR = join(ROOT, 'skills-src')
const MANIFEST = join(SKILLS_DIR, 'MANIFEST.json')
const OVERVIEW_DIR = 'openresearch-cli'
const MODULE_MARKER = /^Bundled modules \(orx skill <name>\):\s*$/
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const check = process.argv.includes('--check')
const offline = process.argv.includes('--offline')

/** Locate the orx executable: $ORX_BIN, then PATH, then the Windows app install. */
export function findOrx() {
  const explicit = process.env.ORX_BIN
  if (explicit && existsSync(explicit)) return explicit
  const names = process.platform === 'win32' ? ['orx.exe', 'orx.cmd', 'orx'] : ['orx']
  for (const dir of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (!dir) continue
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  if (process.platform === 'win32') {
    const installed = join(
      process.env.LOCALAPPDATA ?? '',
      'Programs',
      'OpenResearch',
      'orx.exe',
    )
    if (existsSync(installed)) return installed
  }
  throw new Error(
    'orx not found. Install OpenResearch, or set ORX_BIN to the orx executable path.',
  )
}

/**
 * Run an orx subcommand. orx writes update notices to stderr, so stdout only.
 *
 * Node refuses to spawn a `.cmd`/`.bat` directly on Windows (EINVAL since the
 * CVE-2024-27980 fix), and the installer deliberately puts the `orx` command on
 * PATH as `orx.cmd`. Batch shims are therefore run through an explicit
 * `cmd.exe /c` with every argument quoted, rather than via `shell: true`, which
 * would re-split the arguments.
 */
function orx(bin, args) {
  const quote = (value) => `"${String(value).replace(/"/g, '""')}"`
  const options = {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  }
  // Batch shims go through the shell as one pre-quoted string. Passing an args
  // array together with `shell: true` would let Node concatenate unescaped
  // arguments (DEP0190), so the command line is built explicitly instead.
  const isBatch = /\.(cmd|bat)$/i.test(bin)
  try {
    return isBatch
      ? execFileSync([quote(bin), ...args.map(quote)].join(' '), { ...options, shell: true })
      : execFileSync(bin, args, options)
  } catch (error) {
    // A pending self-update can make orx exit non-zero while still printing the
    // whole document; keep stdout when there is any, and fail only when empty.
    if (typeof error?.stdout === 'string' && error.stdout.trim()) return error.stdout
    throw error
  }
}

/** Parse the leading YAML frontmatter block into name/description. */
export function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
  if (!match) return null
  const read = (key) => {
    const line = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(match[1])
    if (!line) return undefined
    const raw = line[1].trim()
    const quoted = /^"(.*)"$/.exec(raw) ?? /^'(.*)'$/.exec(raw)
    return (quoted ? quoted[1] : raw).replace(/\\"/g, '"')
  }
  return { name: read('name'), description: read('description') }
}

/** Module names listed at the end of the overview, in publication order. */
export function moduleNames(overview) {
  const lines = overview.split(/\r?\n/)
  const start = lines.findIndex((line) => MODULE_MARKER.test(line.trim()))
  if (start === -1) throw new Error('Could not find the "Bundled modules" index in `orx skill`.')
  const names = []
  for (const line of lines.slice(start + 1)) {
    const match = /^\s+(orx-[a-z0-9-]+)\s+\S/.exec(line)
    if (match) names.push(match[1])
  }
  if (names.length === 0) throw new Error('The "Bundled modules" index was empty.')
  return names
}

/** Normalize line endings so a Windows checkout and CI compare equal. */
export const normalize = (text) => `${text.replace(/\r\n/g, '\n').trimEnd()}\n`

/** Content hash, so a built tree can be checked without the orx binary. */
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

/**
 * Pack-owned skills, hand-authored in `skills-src/`.
 *
 * These exist because OpenResearch's vendored instructions refer to a *session
 * playbook* that only `orx up` injects into its own agent sessions. Running the
 * same skills from DSH would leave those references dangling, so the pack ships
 * its own playbook skill. Keeping authored sources in a separate directory means
 * `skills/` stays a build output: `orx` modules are replaced wholesale on sync
 * while authored skills are never silently deleted.
 */
function authoredSkills(generatedNames) {
  const documents = new Map()
  if (!existsSync(AUTHORED_DIR)) return documents

  for (const entry of readdirSync(AUTHORED_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      throw new Error(`skills-src/${entry.name} is not a directory; each authored skill is a bundle`)
    }
    const name = entry.name
    const file = join(AUTHORED_DIR, name, 'SKILL.md')
    if (!existsSync(file)) throw new Error(`skills-src/${name} has no SKILL.md`)

    const body = normalize(readFileSync(file, 'utf8'))
    const meta = frontmatter(body)
    if (!meta) throw new Error(`skills-src/${name}: document has no frontmatter.`)
    if (meta.name !== name) {
      throw new Error(`skills-src/${name}: frontmatter name is "${meta.name}", expected "${name}".`)
    }
    if (!meta.description) throw new Error(`skills-src/${name}: frontmatter has no description.`)
    // A collision would make the deployed skill depend on write order, so refuse
    // it outright rather than letting one source quietly win.
    if (generatedNames.has(name)) {
      throw new Error(`skills-src/${name} collides with a generated orx module of the same name.`)
    }
    documents.set(name, body)
  }
  return documents
}

function main() {
  // Decide before touching orx: the offline check must work on a machine that
  // has no `orx` at all, which is exactly the CI case.
  if (check && offline) return verifyOffline()

  const bin = findOrx()
  // `orx --version` prints "orx 0.2.18"; keep the bare version for the manifest.
  const version = orx(bin, ['--version'])
    .trim()
    .replace(/^orx\s+/i, '')

  const overview = normalize(orx(bin, ['skill']))
  const overviewMeta = frontmatter(overview)
  if (!overviewMeta) throw new Error('The overview document has no frontmatter.')
  if (overviewMeta.name !== OVERVIEW_DIR) {
    throw new Error(
      `Overview skill name is "${overviewMeta.name}", expected "${OVERVIEW_DIR}".`,
    )
  }

  const documents = new Map([[OVERVIEW_DIR, overview]])
  const modules = []
  for (const name of moduleNames(overview)) {
    const body = normalize(orx(bin, ['skill', name]))
    const meta = frontmatter(body)
    if (!meta) throw new Error(`${name}: document has no frontmatter.`)
    if (meta.name !== name) throw new Error(`${name}: frontmatter name is "${meta.name}".`)
    if (!meta.description) throw new Error(`${name}: frontmatter has no description.`)
    documents.set(name, body)
    modules.push({
      name,
      description: meta.description,
      bytes: Buffer.byteLength(body, 'utf8'),
      sha256: sha256(body),
    })
  }

  const authored = authoredSkills(new Set(documents.keys()))
  const authoredEntries = []
  for (const [name, body] of authored) {
    documents.set(name, body)
    authoredEntries.push({
      name,
      description: frontmatter(body).description,
      bytes: Buffer.byteLength(body, 'utf8'),
      sha256: sha256(body),
    })
  }

  for (const name of documents.keys()) {
    if (!KEBAB.test(name)) throw new Error(`"${name}" is not a valid skill name.`)
  }

  const manifest = {
    generatedBy: 'scripts/sync-skills.mjs',
    orxVersion: version,
    overview: OVERVIEW_DIR,
    modules,
    authored: authoredEntries.sort((a, b) => a.name.localeCompare(b.name)),
  }

  // Online check compares against the *installed* CLI, so it catches a stale
  // build after an orx upgrade. The offline check only proves the committed tree
  // still matches the committed manifest, which is what CI can do without orx.
  if (check) return verify(documents, manifest)
  write(documents, manifest)
}

/**
 * Integrity check with no `orx` dependency: every manifest entry must still
 * match the file on disk, and the tree must contain nothing the manifest does
 * not describe. This is the gate CI can run.
 */
function verifyOffline() {
  const problems = []
  if (!existsSync(MANIFEST)) {
    console.error('skills/MANIFEST.json is missing; run: node scripts/sync-skills.mjs')
    process.exitCode = 1
    return
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  const entries = [
    ...(manifest.modules ?? []),
    ...(manifest.authored ?? []),
    { name: manifest.overview },
  ].filter((entry) => entry?.name)

  for (const entry of entries) {
    const file = join(SKILLS_DIR, entry.name, 'SKILL.md')
    if (!existsSync(file)) {
      problems.push(`missing skills/${entry.name}/SKILL.md`)
      continue
    }
    const body = normalize(readFileSync(file, 'utf8'))
    const meta = frontmatter(body)
    if (!meta) problems.push(`skills/${entry.name}: frontmatter is not parseable`)
    else if (meta.name !== entry.name) problems.push(`skills/${entry.name}: declares name "${meta.name}"`)
    else if (!meta.description) problems.push(`skills/${entry.name}: no description`)
    if (entry.sha256 && sha256(body) !== entry.sha256) {
      problems.push(`skills/${entry.name}: content does not match MANIFEST (sha256)`)
    }
  }

  const expected = new Set([...entries.map((entry) => entry.name), 'MANIFEST.json'])
  for (const dir of readdirSync(SKILLS_DIR)) {
    if (!expected.has(dir)) problems.push(`unexpected skills/${dir}`)
  }

  if (problems.length > 0) {
    console.error(`skills/ fails integrity check (${problems.length} problem(s)):`)
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error('Run: node scripts/sync-skills.mjs')
    process.exitCode = 1
    return
  }
  console.log(
    `skills/ integrity OK — ${entries.length} skills match MANIFEST (orx ${manifest.orxVersion}).`,
  )
}

/** Compare the tree on disk against freshly generated output. */
function verify(documents, manifest) {
  const problems = []
  const authoredNames = new Set(manifest.authored.map((entry) => entry.name))
  if (!existsSync(MANIFEST)) {
    problems.push('skills/MANIFEST.json is missing')
  } else {
    const onDisk = JSON.parse(readFileSync(MANIFEST, 'utf8'))
    if (onDisk.orxVersion !== manifest.orxVersion) {
      problems.push(`orx version drift: manifest ${onDisk.orxVersion}, installed ${manifest.orxVersion}`)
    }
  }
  for (const [name, body] of documents) {
    const file = join(SKILLS_DIR, name, 'SKILL.md')
    if (!existsSync(file)) {
      problems.push(`missing skills/${name}/SKILL.md`)
      continue
    }
    // An authored skill's source of truth is skills-src, not the built copy, so
    // point the reader at the file they are actually supposed to edit.
    const hint = authoredNames.has(name) ? ` (edit skills-src/${name}/SKILL.md)` : ''
    if (normalize(readFileSync(file, 'utf8')) !== body) {
      problems.push(`stale skills/${name}/SKILL.md${hint}`)
    }
  }
  if (existsSync(SKILLS_DIR)) {
    const expected = new Set([...documents.keys(), 'MANIFEST.json'])
    for (const entry of readdirSync(SKILLS_DIR)) {
      if (!expected.has(entry)) problems.push(`unexpected skills/${entry}`)
    }
  }
  if (problems.length > 0) {
    console.error(`skills/ is stale (${problems.length} problem(s)):`)
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error('Run: node scripts/sync-skills.mjs')
    process.exitCode = 1
    return
  }
  console.log(
    `skills/ matches orx ${manifest.orxVersion} — ${documents.size} skills ` +
      `(${manifest.modules.length} orx modules + overview + ${manifest.authored.length} authored).`,
  )
}

function write(documents, manifest) {
  // Replace the whole tree: a module removed upstream must not linger, because a
  // stale skill would keep instructing the agent to run commands that no longer exist.
  if (existsSync(SKILLS_DIR)) {
    const keep = new Set([...documents.keys(), 'MANIFEST.json'])
    for (const entry of readdirSync(SKILLS_DIR)) {
      if (!keep.has(entry)) rmSync(join(SKILLS_DIR, entry), { recursive: true, force: true })
    }
  }
  for (const [name, body] of documents) {
    const dir = join(SKILLS_DIR, name)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'SKILL.md')
    if (existsSync(file) && normalize(readFileSync(file, 'utf8')) === body) continue
    writeFileSync(file, body)
  }
  mkdirSync(SKILLS_DIR, { recursive: true })
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(
    `Wrote ${documents.size} skills from orx ${manifest.orxVersion} to skills/ ` +
      `(${manifest.modules.length} orx modules + overview + ${manifest.authored.length} authored)`,
  )
}

// Run only when executed directly, so tests can import the pure helpers above.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
