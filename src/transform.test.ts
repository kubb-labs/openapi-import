import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pluginTs } from '@kubb/plugin-ts'
import { pluginZod } from '@kubb/plugin-zod'
import { describe, expect, test } from 'vitest'
import { transform } from './transform.ts'

const fileName = path.resolve(import.meta.dirname, '../examples/pet-store/openapi.yaml')

describe('transform', () => {
  test('returns the plugin-ts types of a spec as one module', async () => {
    const result = await transform({ fileName, content: await readFile(fileName, 'utf8') })

    expect(result.diagnostics).toBeUndefined()
    expect(result.text).toContain('export type Pet = {')
    expect(result.text).not.toMatch(/^import /m)
  })

  test('runs every plugin of the Kubb config into the one module', async () => {
    const config = {
      output: { path: './gen' },
      plugins: [pluginTs({ output: { path: 'types' }, group: { type: 'tag' } }), pluginZod({ output: { path: 'zod' } })],
    }
    const result = await transform({ fileName, content: await readFile(fileName, 'utf8') }, config)
    const mapped = (result.mappings ?? []).map(([start, length]) => result.text.slice(start, start + length))

    expect(result.diagnostics).toBeUndefined()
    expect(result.text).toContain('export type Pet = {')
    expect(result.text).toContain('export const petSchema = z.object(')
    expect(result.text).toMatch(/^import \* as z from 'zod'$/m)
    expect(mapped).toContain('petSchema')
  })

  test('maps openapi.yaml and *.openapi.yaml and leaves other YAML files empty', async () => {
    const content = await readFile(fileName, 'utf8')
    const named = await transform({ fileName: path.join(path.dirname(fileName), 'pet.openapi.yml'), content })
    const other = await transform({ fileName: path.join(path.dirname(fileName), 'docker-compose.yaml'), content: 'services: {}' })
    const lookalike = await transform({ fileName: path.join(path.dirname(fileName), 'myopenapi.yaml'), content })

    expect(named.text).toContain('export type Pet = {')
    expect(other).toEqual({ text: 'export {}', extension: '.ts' })
    expect(lookalike).toEqual({ text: 'export {}', extension: '.ts' })
  })

  test('reports a kubb.config.ts that generates no code', async () => {
    const result = await transform({ fileName, content: await readFile(fileName, 'utf8') }, { output: { path: '.' }, plugins: [] })

    expect(result.text).toBe('export {}')
    expect(result.diagnostics?.[0]?.messageText).toContain('generated no code')
  })

  test('returns an empty module and a diagnostic at the syntax error for an invalid spec', async () => {
    const content = 'openapi: 3.0.0\ninfo: [oops\n'
    const result = await transform({ fileName, content })
    const [diagnostic] = result.diagnostics ?? []

    expect(result.text).toBe('export {}')
    expect(result.diagnostics).toHaveLength(1)
    expect(diagnostic?.messageText).toContain('Flow sequence')
    expect(diagnostic!.start).toBeGreaterThan(content.indexOf('info'))
  })

  test('places a spec error on the key it points at', async () => {
    const content = [
      'openapi: 3.0.0',
      'info: { title: Pets, version: "1" }',
      'paths: {}',
      'components:',
      '  schemas:',
      '    Pet:',
      '      properties:',
      "        owner: { $ref: '#/components/schemas/Missing' }",
      '',
    ].join('\n')
    const [diagnostic] = (await transform({ fileName, content })).diagnostics ?? []

    expect(content.slice(diagnostic!.start, diagnostic!.start + diagnostic!.length)).toBe("'#/components/schemas/Missing'")
  })
})

describe('transform mappings', async () => {
  const content = await readFile(fileName, 'utf8')
  const result = await transform({ fileName, content })

  /**
   * Each generated name with the spec text and line it maps to.
   */
  const mapped = (result.mappings ?? []).map(([virtualStart, virtualLength, originalStart, originalLength]) => ({
    name: result.text.slice(virtualStart, virtualStart + virtualLength),
    key: content.slice(originalStart, originalStart + originalLength),
    line: content.slice(0, originalStart).split('\n').length,
  }))
  const lineOf = (pattern: RegExp) => content.split('\n').findIndex((line) => pattern.test(line)) + 1

  test('maps a component schema to its key under components.schemas', () => {
    expect(mapped).toContainEqual({ name: 'Pet', key: 'Pet', line: lineOf(/^ {4}Pet:/) })
  })

  test('maps schema properties to their keys under properties', () => {
    const petLine = lineOf(/^ {4}Pet:/)
    const name = mapped.find((entry) => entry.name === 'name' && entry.line > petLine)

    expect(name).toMatchObject({ key: 'name' })
    expect(mapped.filter((entry) => entry.name === 'photoUrls').map((entry) => entry.key)).toContain('photoUrls')
  })

  test('maps an extracted enum and its key type to the property it came from', () => {
    const status = mapped.find((entry) => entry.name === 'OrderStatusEnumKey')

    expect(status).toMatchObject({ key: 'status' })
    expect(mapped.find((entry) => entry.name === 'orderStatusEnum')).toStrictEqual(status && { ...status, name: 'orderStatusEnum' })
  })

  test('maps operation types to the operation, its parameters and its responses', () => {
    const getLine = lineOf(/^ {2}\/pet\/\{petId\}:/) + 1

    expect(mapped).toContainEqual({ name: 'GetPetByIdResponse', key: 'get', line: getLine })
    expect(mapped.find((entry) => entry.name === 'GetPetByIdPath')).toMatchObject({ key: 'parameters' })
    expect(mapped.find((entry) => entry.name === 'GetPetByIdStatus404')).toMatchObject({ key: "'404'" })
    expect(mapped.find((entry) => entry.name === 'AddPetBody')).toMatchObject({ key: 'requestBody' })
  })

  test('lets a schema type rename its key, but not a property', () => {
    const segment = (name: string) => (result.mappings ?? []).find(([start, length]) => result.text.slice(start, start + length) === name)
    const rename = 256

    expect(segment('Pet')?.[4]).toBe(0)
    expect(segment('Pet')![5] & rename).toBe(rename)
    expect(segment('photoUrls')?.[4]).toBe(2)
    expect(segment('photoUrls')![5] & rename).toBe(0)
  })

  test('keeps segments ordered by virtual start', () => {
    const starts = (result.mappings ?? []).map(([virtualStart]) => virtualStart)

    expect(starts).toStrictEqual([...starts].sort((a, b) => a - b))
  })
})

describe('transform casing', () => {
  const content = [
    'openapi: 3.0.0',
    'info: { title: Pets, version: "1" }',
    'paths:',
    '  /pets/{id}:',
    '    get:',
    '      operationId: getPet',
    '      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]',
    '      responses:',
    "        '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/pet' } } } }",
    'components:',
    '  schemas:',
    '    pet:',
    '      type: object',
    '      properties:',
    '        owner: { $ref: "#/components/schemas/pet_owner" }',
    '    pet_owner: { type: object, properties: { name: { type: string } } }',
    '    class: { type: string }',
    '',
  ].join('\n')

  test('names schema types after their spec keys and renames those keys', async () => {
    const result = await transform({ fileName, content })
    const rename = (name: string) => (result.mappings ?? []).find(([start, length]) => result.text.slice(start, start + length) === name)

    expect(result.diagnostics).toBeUndefined()
    expect(result.text).toContain('export type pet = {')
    expect(result.text).toContain('export type pet_owner = ')
    expect(result.text).toContain('export type Class = ')
    expect(rename('pet')![5] & 256).toBe(256)
    expect(rename('Class')![5] & 256).toBe(0)
  })

  test('keeps operation types PascalCase and linked to the operation', async () => {
    const result = await transform({ fileName, content })
    const mapped = (result.mappings ?? []).map(([start, length, original, originalLength]) => [
      result.text.slice(start, start + length),
      content.slice(original, original + originalLength),
    ])

    expect(result.text).toContain('export type GetPetStatus200 = ')
    expect(mapped).toContainEqual(['GetPetStatus200', "'200'"])
  })

  test('keeps casing for a plugin-ts of the Kubb config unless it sets its own resolver', async () => {
    const result = await transform({ fileName, content }, { output: { path: '.' }, plugins: [pluginTs()] })
    const custom = await transform({ fileName, content }, { output: { path: '.' }, plugins: [pluginTs({ resolver: { name: (name: string) => `X${name}` } })] })

    expect(result.text).toContain('export type pet = ')
    expect(custom.text).toContain('export type Xpet = ')
  })

  test('renames a $ref with the schema type it points at', async () => {
    const result = await transform({ fileName, content })
    const refs = (result.mappings ?? [])
      .filter(([, , , , , features]) => features & 256)
      .map(([start, length, original, originalLength]) => [result.text.slice(start, start + length), content.slice(original - 21, original + originalLength)])

    expect(refs).toContainEqual(['pet_owner', '#/components/schemas/pet_owner'])
  })
})
