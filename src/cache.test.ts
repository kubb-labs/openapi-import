import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { cacheTransform } from './cache.ts'

describe('cacheTransform', () => {
  test('reuses the result for the same file, content and config', async () => {
    const transform = vi.fn(async ({ content }: { content: string }) => ({ text: content.toUpperCase() }))
    const cached = cacheTransform(transform)

    expect(await cached({ fileName: 'a.yaml', content: 'a' })).toEqual({ text: 'A' })
    expect(await cached({ fileName: 'a.yaml', content: 'a' })).toEqual({ text: 'A' })
    expect(transform).toHaveBeenCalledTimes(1)
  })

  test('transforms again when the content or the config changes', async () => {
    const transform = vi.fn(async ({ content }: { content: string }) => ({ text: content }))
    const cached = cacheTransform(transform)

    await cached({ fileName: 'a.yaml', content: 'a' })
    await cached({ fileName: 'a.yaml', content: 'b' })
    await cached({ fileName: 'a.yaml', content: 'b' }, { output: { path: '.' } })
    expect(transform).toHaveBeenCalledTimes(3)
  })

  test('transforms again when a file an external $ref read changes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'openapi-import-'))
    const pet = path.join(dir, 'pet.yaml')
    const missing = path.join(dir, 'missing.yaml')
    await writeFile(pet, 'type: object')
    const transform = vi.fn(async () => ({ text: '', dependencies: { [pet]: 'type: object', [missing]: null } }))
    const cached = cacheTransform(transform)

    await cached({ fileName: 'a.yaml', content: 'a' })
    await cached({ fileName: 'a.yaml', content: 'a' })
    expect(transform).toHaveBeenCalledTimes(1)

    await writeFile(pet, 'type: string')
    await cached({ fileName: 'a.yaml', content: 'a' })
    expect(transform).toHaveBeenCalledTimes(2)
    await rm(dir, { recursive: true, force: true })
  })

  test('does not keep a failed transform', async () => {
    const transform = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ text: 'ok' })
    const cached = cacheTransform(transform)

    await expect(cached({ fileName: 'a.yaml', content: 'a' })).rejects.toThrow('boom')
    expect(await cached({ fileName: 'a.yaml', content: 'a' })).toEqual({ text: 'ok' })
  })
})
