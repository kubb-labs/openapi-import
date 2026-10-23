import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { loadProjectConfig } from './config.ts'

describe('loadProjectConfig', () => {
  let dir = ''

  // Inside the repo, which has no kubb.config.* above it, so findConfigFile finds nothing else.
  beforeEach(async () => {
    await mkdir(path.join(import.meta.dirname, '../node_modules/.cache'), { recursive: true })
    dir = await mkdtemp(path.join(import.meta.dirname, '../node_modules/.cache/openapi-import-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('loads kubb.config.ts and hashes it as the identity', async () => {
    await writeFile(path.join(dir, 'kubb.config.ts'), "export default { input: './pet.openapi.yaml', output: { path: './gen' } }\n")
    const config = await loadProjectConfig(path.join(dir))

    expect(config).toMatchObject({ dir, watchedFiles: expect.arrayContaining([path.join(dir, 'kubb.config.ts')]), configs: [{ input: './pet.openapi.yaml' }] })
    expect(config.identity).toMatch(/^[0-9a-f]{64}$/)
    expect(config.error).toBeUndefined()
  })

  test('watches every config file the CLI would pick up when there is no config', async () => {
    const config = await loadProjectConfig(dir)

    expect(config).toMatchObject({ dir, configs: [], identity: 'none' })
    expect(config.watchedFiles).toContain(path.join(dir, 'kubb.config.ts'))
    expect(config.watchedFiles).toContain(path.join(dir, '.config', 'kubb.config.js'))
  })

  test('finds a config in .config/', async () => {
    await mkdir(path.join(dir, '.config'))
    await writeFile(path.join(dir, '.config', 'kubb.config.ts'), "export default { input: './pet.openapi.yaml', output: { path: './gen' } }\n")
    const config = await loadProjectConfig(dir)

    expect(config.configs).toMatchObject([{ input: './pet.openapi.yaml' }])
    expect(config.watchedFiles[0]).toBe(path.join(dir, '.config', 'kubb.config.ts'))
  })

  test('reports a config that fails to load', async () => {
    await writeFile(path.join(dir, 'kubb.config.ts'), "throw new Error('broken config')\n")
    const config = await loadProjectConfig(dir)

    expect(config.configs).toStrictEqual([])
    expect(config.error).toContain('broken config')
  })
})
