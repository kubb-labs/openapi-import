import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDecoder, encode, type Message } from './rpc.ts'

const repo = path.resolve(import.meta.dirname, '..')
const tsc = path.join(repo, 'node_modules/typescript/bin/tsc')
const uri = (file: string) => pathToFileURL(file).href

/**
 * Starts the TypeScript 7 language server in `dir` and answers its requests to the editor. It
 * keeps the glob of every file watcher the server registers, since an editor only reports changes
 * to files those globs match.
 */
function startLanguageServer(dir: string) {
  const server = spawn(process.execPath, [tsc, '--lsp', '--stdio'], { cwd: dir, stdio: ['pipe', 'pipe', 'inherit'] })
  const watched = new Set<string>()
  const pending = new Map<Message['id'], (message: Message) => void>()
  let nextId = 0

  server.stdout.on(
    'data',
    createDecoder((message) => {
      if (message.method && message.id !== undefined) {
        const { registrations = [] } = (message.params ?? {}) as { registrations?: Array<{ registerOptions?: { watchers?: Array<{ globPattern: string }> } }> }
        for (const watcher of registrations.flatMap((registration) => registration.registerOptions?.watchers ?? [])) watched.add(watcher.globPattern)
        server.stdin.write(encode({ id: message.id, result: null }))
        return
      }
      if (message.method) return
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    }),
  )

  const request = (method: string, params: unknown) =>
    new Promise<any>((resolve) => {
      const id = nextId++
      pending.set(id, (message) => resolve(message.result))
      server.stdin.write(encode({ id, method, params }))
    })
  const notify = (method: string, params: unknown) => server.stdin.write(encode({ method, params }))

  const close = () => {
    server.stdout.removeAllListeners('data')
    server.kill()
  }

  return { request, notify, watched, close }
}

describe('watch mode', () => {
  let dir = ''

  beforeAll(async () => {
    // Outside node_modules, which the language server does not watch, with the mapper package linked in.
    dir = await mkdtemp(path.join(tmpdir(), 'openapi-import-watch-'))
    await cp(path.join(repo, 'fixtures/external-ref'), dir, { recursive: true })
    await mkdir(path.join(dir, 'node_modules'))
    await symlink(repo, path.join(dir, 'node_modules/openapi-import'), 'dir')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('updates types and diagnostics when only a file behind an external $ref changes', { timeout: 60_000 }, async () => {
    const index = path.join(dir, 'index.ts')
    const schema = path.join(dir, 'schemas/pet.yaml')
    const text = await readFile(index, 'utf8')
    const position = { line: 0, character: text.indexOf('Pet') }
    const server = startLanguageServer(dir)

    const hover = async (): Promise<string> =>
      (await server.request('textDocument/hover', { textDocument: { uri: uri(index) }, position }))?.contents?.value ?? ''
    const diagnostics = async (): Promise<Array<string>> =>
      ((await server.request('textDocument/diagnostic', { textDocument: { uri: uri(index) } }))?.items ?? []).map((item: { message: string }) => item.message)
    const waitFor = async (check: () => Promise<boolean>) => {
      for (let attempt = 0; attempt < 100 && !(await check()); attempt++) await new Promise((resolve) => setTimeout(resolve, 100))
    }

    try {
      await server.request('initialize', {
        processId: process.pid,
        rootUri: uri(dir),
        capabilities: { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } }, textDocument: { diagnostic: {} } },
        initializationOptions: { runExternalCode: true },
      })
      server.notify('initialized', {})
      server.notify('textDocument/didOpen', { textDocument: { uri: uri(index), languageId: 'typescript', version: 1, text } })

      expect(await hover()).toContain('name: string')
      expect(await diagnostics()).toEqual([])
      // The server registers the watchers for `watchedFiles` after it opened the project.
      await waitFor(async () => server.watched.has(schema))
      expect(server.watched).toContain(schema)

      await writeFile(schema, (await readFile(schema, 'utf8')).replace('type: string', 'type: number'))
      server.notify('workspace/didChangeWatchedFiles', { changes: [{ uri: uri(schema), type: 2 }] })

      await waitFor(async () => (await hover()).includes('name: number'))
      expect(await hover()).toContain('name: number')
      expect(await diagnostics()).toEqual([expect.stringContaining("Type 'string' is not assignable to type 'number'")])
    } finally {
      server.close()
    }
  })
})
