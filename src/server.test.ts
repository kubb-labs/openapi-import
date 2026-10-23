import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDecoder, encode, type Message } from './rpc.ts'

const repo = path.resolve(import.meta.dirname, '..')
const spec = path.join(repo, 'examples/pet-store/openapi.yaml')

/**
 * Starts the built server and sends every request at once, without waiting for replies.
 */
async function send(requests: Array<{ method: string; params: unknown }>): Promise<Array<Message>> {
  const server = spawn(process.execPath, [path.join(repo, 'dist/server.js')], { stdio: ['pipe', 'pipe', 'inherit'] })
  const replies = new Map<unknown, Message>()
  const done = new Promise<void>((resolve) => {
    server.stdout.on(
      'data',
      createDecoder((message) => {
        replies.set(message.id, message)
        if (replies.size === requests.length) resolve()
      }),
    )
  })
  for (const [id, request] of requests.entries()) server.stdin.write(encode({ id, ...request }))
  await done
  server.kill()
  return requests.map((_, id) => replies.get(id)!)
}

describe('server', () => {
  let dir = ''

  beforeAll(async () => {
    // Inside the repo, so the config can import the plugins from its node_modules.
    await mkdir(path.join(repo, 'node_modules/.cache'), { recursive: true })
    dir = await mkdtemp(path.join(repo, 'node_modules/.cache/openapi-import-'))
    await mkdir(path.join(dir, 'with-config/.config'), { recursive: true })
    await mkdir(path.join(dir, 'without-config'))
    await copyFile(spec, path.join(dir, 'with-config/openapi.yaml'))
    await copyFile(spec, path.join(dir, 'without-config/openapi.yaml'))
    await writeFile(
      path.join(dir, 'with-config/.config/kubb.config.ts'),
      [
        "import { pluginTs } from '@kubb/plugin-ts'",
        "import { pluginZod } from '@kubb/plugin-zod'",
        'export default [',
        "  { input: './other.openapi.yaml', output: { path: './gen' }, plugins: [pluginTs()] },",
        "  { input: './openapi.yaml', output: { path: './gen' }, plugins: [pluginTs(), pluginZod()] },",
        ']',
      ].join('\n'),
    )
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('waits for the config, picks the matching one from .config/ and reports tsconfig options', async () => {
    const project = path.join(dir, 'with-config')
    const fileName = path.join(project, 'openapi.yaml')
    const [, opened, transformed] = await send([
      { method: 'initialize', params: {} },
      { method: 'openProject', params: { projectHandle: 'p', configFileName: path.join(project, 'tsconfig.json'), options: { arrayType: 'generic' } } },
      { method: 'transform', params: { projectHandle: 'p', fileName, content: await readFile(fileName, 'utf8') } },
    ])
    const result = transformed!.result as { text: string }

    expect(opened!.result).toMatchObject({ optionDiagnostics: [{ messageText: expect.stringContaining('kubb.config.ts') }] })
    expect(result.text).toContain('export type Pet = {')
    expect(result.text).toContain('export const petSchema = z.object(')
  })

  test('runs plugin-ts without a kubb.config.ts', async () => {
    const project = path.join(dir, 'without-config')
    const fileName = path.join(project, 'openapi.yaml')
    const [, opened, transformed] = await send([
      { method: 'initialize', params: {} },
      { method: 'openProject', params: { projectHandle: 'p', configFileName: path.join(project, 'tsconfig.json') } },
      { method: 'transform', params: { projectHandle: 'p', fileName, content: await readFile(fileName, 'utf8') } },
    ])
    const result = transformed!.result as { text: string }

    expect(opened!.result).toMatchObject({ configIdentity: 'none' })
    expect(opened!.result).not.toHaveProperty('optionDiagnostics')
    expect(result.text).toContain('export type Pet = {')
    expect(result.text).not.toContain('z.object(')
  })
})
