import { dirname } from 'node:path'
import { selectConfig } from 'unplugin-kubb'
import { cacheTransform } from './cache.ts'
import { loadProjectConfig, type ProjectConfig } from './config.ts'
import { createDecoder, encode, type Message } from './rpc.ts'
import { transform, type TransformParams } from './transform.ts'

// stdout carries the protocol, so every other stdout write (any console method, direct writes from
// Kubb or its plugins) goes to stderr.
const writeProtocol = process.stdout.write.bind(process.stdout)
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write

const projects = new Map<string, ProjectConfig>()

const cachedTransform = cacheTransform(transform)

const handlers: Record<string, (params: never) => unknown> = {
  initialize: () => ({ protocolVersion: 1, positionEncoding: 'utf-16', diagnosticSource: 'kubb' }),
  // `dynamicConfig` in package.json: TypeScript watches `watchedFiles` and opens the project again
  // when one changes, then transforms its specs again when `configIdentity` differs.
  openProject: async ({ projectHandle, configFileName }: { projectHandle: string; configFileName?: string }) => {
    const project = await loadProjectConfig(configFileName ? dirname(configFileName) : process.cwd())
    projects.set(projectHandle, project)

    return { configIdentity: project.identity, watchedFiles: [project.file] }
  },
  closeProject: ({ projectHandle }: { projectHandle: string }) => {
    projects.delete(projectHandle)
    return null
  },
  transform: async (params: TransformParams & { projectHandle: string }) => {
    const project = projects.get(params.projectHandle)
    if (project?.error) return { text: 'export {}', extension: '.ts', diagnostics: [{ messageText: project.error, start: 0, length: 0 }] }

    return cachedTransform(params, project && selectConfig(project.configs, params.fileName, dirname(project.file)))
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
