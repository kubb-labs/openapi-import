import { createHash } from 'node:crypto'
import { globSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import ts from '@typescript/typescript6'
import { selectConfig } from 'unplugin-kubb'
import { cacheTransform, readOrNull } from './cache.ts'
import { loadProjectConfig, type ProjectConfig } from './config.ts'
import { createDecoder, encode, type Message } from './rpc.ts'
import { readDependencies, transform, type TransformParams } from './transform.ts'

// stdout carries the protocol, so every other stdout write (any console method, direct writes from
// Kubb or its plugins) goes to stderr.
const writeProtocol = process.stdout.write.bind(process.stdout)
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write

// The load promise is stored right away, so a transform sent before the load finishes waits for it.
const projects = new Map<string, Promise<ProjectConfig>>()

const cachedTransform = cacheTransform(transform)

// shortcut: one list for every project, and a file stays watched after its `$ref` is gone; split it per project if a stray reload matters.
const dependencies = new Set<string>()

/**
 * The files that external `$ref`s read in the specs under the tsconfig folder, outside
 * `node_modules`, with an extension that `contentMappers` maps to this package. TypeScript only
 * watches what `openProject` returns, so these are found before the first transform.
 */
async function findDependencies(configFileName: string): Promise<Array<string>> {
  const { config } = ts.readConfigFile(configFileName, ts.sys.readFile)
  const mappers: Array<{ package?: string; extensions?: Array<string> }> = config?.contentMappers ?? []
  // shortcut: a `contentMappers` entry that comes from `extends` is not read, look it up too if someone relies on it.
  const extensions = mappers.filter((mapper) => mapper.package === 'openapi-import').flatMap((mapper) => mapper.extensions ?? [])
  if (!extensions.length) return []

  const dir = dirname(configFileName)
  const specs = globSync(
    extensions.map((extension) => `**/*${extension}`),
    { cwd: dir, exclude: (file) => basename(String(file)) === 'node_modules' },
  )
  // A spec that does not parse has nothing to watch yet; its transform reports the error.
  const found = await Promise.all(specs.map((spec) => readDependencies(resolve(dir, spec)).catch(() => [])))
  return found.flat()
}

const handlers: Record<string, (params: never) => unknown> = {
  initialize: () => ({ protocolVersion: 1, positionEncoding: 'utf-16', diagnosticSource: 'kubb' }),
  // `dynamicConfig` in package.json: TypeScript watches `watchedFiles` and opens the project again
  // when one changes, then transforms its specs again when `configIdentity` differs. The files that
  // external `$ref`s read are watched too, so a changed schema file updates the spec that points at it.
  openProject: async ({ projectHandle, configFileName, options }: { projectHandle: string; configFileName?: string; options?: unknown }) => {
    const loading = loadProjectConfig(configFileName ? dirname(configFileName) : process.cwd())
    projects.set(projectHandle, loading)
    const project = await loading
    for (const file of configFileName ? await findDependencies(configFileName) : []) dependencies.add(file)
    // TypeScript only transforms again when the identity changes, so it covers the `$ref` files too.
    const identity = createHash('sha256').update(project.identity)
    for (const file of dependencies) identity.update(`\0${file}\0${readOrNull(file) ?? ''}`)

    return {
      configIdentity: dependencies.size ? identity.digest('hex') : project.identity,
      watchedFiles: [...new Set([...project.watchedFiles, ...dependencies])],
      ...(options != null && { optionDiagnostics: [{ path: [], messageText: 'openapi-import has no options. Set plugin options in kubb.config.ts.' }] }),
    }
  },
  closeProject: ({ projectHandle }: { projectHandle: string }) => {
    projects.delete(projectHandle)
    return null
  },
  transform: async (params: TransformParams & { projectHandle: string }) => {
    const project = await projects.get(params.projectHandle)
    if (project?.error) return { text: 'export {}', extension: '.ts', diagnostics: [{ messageText: project.error, start: 0, length: 0 }] }

    const { dependencies: files, ...result } = await cachedTransform(
      params,
      project && selectConfig({ configs: project.configs, fileName: params.fileName, cwd: project.dir }),
    )
    for (const file of Object.keys(files ?? {})) dependencies.add(file)
    return result
  },
}

async function handle({ id, method = '', params }: Message): Promise<void> {
  const handler = handlers[method]
  if (id === undefined) return

  try {
    if (!handler) {
      writeProtocol(encode({ id, error: { code: -32601, message: `Unknown method "${method}"` } }))
      return
    }
    const result = await handler(params as never)
    writeProtocol(encode({ id, result: result ?? null }))
  } catch (error) {
    writeProtocol(encode({ id, error: { code: -32603, message: error instanceof Error ? (error.stack ?? error.message) : String(error) } }))
  }
}

process.stdin.on(
  'data',
  createDecoder((message) => void handle(message)),
)
