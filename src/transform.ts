import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import ts from '@typescript/typescript6'
import { bundle } from 'api-ref-bundler'
import type { UserConfig } from 'kubb'
import { Hookable, type KubbHooks } from 'kubb/kit'
import { pluginTs, pluginTsName, resolverTs } from '@kubb/plugin-ts'
import { generateModule } from 'unplugin-kubb'
import { parse, parseDocument } from 'yaml'
import { createLocator } from './locate.ts'
import { createMappings, escapeToken, type Segment } from './mappings.ts'

/**
 * Parameters of the content mapper `transform` request.
 */
export type TransformParams = {
  fileName: string
  content: string
}

/**
 * The module TypeScript checks in place of the spec, and the segments linking it to the spec.
 */
export type TransformResult = {
  text: string
  extension: '.ts'
  mappings?: Array<Segment>
  diagnostics?: Array<{ messageText: string; start: number; length: number }>
  /**
   * The text of each file an external `$ref` read, by absolute path, or `null` when it is missing.
   * The server watches these files. It is not part of the protocol.
   */
  dependencies?: Record<string, string | null>
}

const hasExternalRef = (node: unknown): boolean =>
  !!node &&
  typeof node === 'object' &&
  Object.entries(node).some(([key, value]) => (key === '$ref' && typeof value === 'string' ? !value.startsWith('#') : hasExternalRef(value)))

/**
 * Inlines the files that external `$ref`s point at, the way Kubb bundles a spec it reads from disk.
 * The spec itself comes from `input`, so unsaved edits stay. Every other file read lands in
 * `dependencies`, with `null` for a file that does not exist, and each `$ref` that failed in `errors`.
 */
async function bundleInput(fileName: string, input: unknown) {
  const dependencies: Record<string, string | null> = {}
  const errors: Array<{ message: string; pointer?: string }> = []
  if (!hasExternalRef(input)) return { input, dependencies, errors }

  const bundled = await bundle(
    fileName,
    async (sourcePath) => {
      if (resolve(sourcePath) === resolve(fileName)) return input as object
      const text = await readFile(sourcePath, 'utf8').catch(() => null)
      dependencies[resolve(sourcePath)] = text
      if (text === null) throw new Error(`Cannot read ${sourcePath}`)
      return parse(text)
    },
    {
      hooks: {
        // Only a `$ref` in the spec itself has a key to point the error at.
        onError: (message, { path, state }) =>
          errors.push({
            message,
            pointer: resolve(state.baseFile) === resolve(fileName) ? `/${path.map((token) => escapeToken(String(token))).join('/')}` : undefined,
          }),
      },
    },
  )
  return { input: bundled, dependencies, errors }
}

/**
 * The files that external `$ref`s in the spec at `fileName` read, with the spec as saved on disk.
 */
export async function readDependencies(fileName: string): Promise<Array<string>> {
  const { dependencies } = await bundleInput(fileName, parse(await readFile(fileName, 'utf8')))
  return Object.keys(dependencies)
}

const scanner = ts.createScanner(ts.ScriptTarget.Latest, true)

// A keyword such as `string` or `class` scans as a keyword, not an identifier, so it is not kept.
function isPlainIdentifier(name: string): boolean {
  scanner.setText(name)
  return scanner.scan() === ts.SyntaxKind.Identifier && scanner.getTokenEnd() === name.length
}

/**
 * Keeps a name that is already a valid type name as the spec wrote it (`pet`, `PET_STATUS`), so a
 * schema type matches its key and renames it. Composed names such as `getPetById Status 200` and
 * keys that are not identifiers keep the `@kubb/plugin-ts` PascalCase.
 */
const specName = (name: string) => (isPlainIdentifier(name) ? name : resolverTs.name(name))

/**
 * Lets `@kubb/plugin-ts` name schema types after their spec keys, unless the config sets its own `resolver.name`.
 */
function keepSpecCasing(config: UserConfig): UserConfig {
  return {
    ...config,
    plugins: config.plugins?.map((plugin) =>
      plugin.name === pluginTsName
        ? { ...plugin, options: { ...plugin.options, resolver: { name: specName, ...(plugin.options as { resolver?: object })?.resolver } } }
        : plugin,
    ),
  }
}

/**
 * Generates the module for one spec with `generateModule` from `unplugin-kubb`, the same one a
 * bundler loads. Without a config, only `@kubb/plugin-ts` runs. The spec text comes from the
 * request, so unsaved edits are checked too. It is parsed once and shared by the build, the
 * diagnostics and the mappings.
 */
export async function transform({ fileName, content }: TransformParams, config?: UserConfig): Promise<TransformResult> {
  const document = parseDocument(content)
  if (document.errors.length) {
    return {
      text: 'export {}',
      extension: '.ts',
      diagnostics: document.errors.map((error) => ({ messageText: error.message, start: error.pos[0], length: error.pos[1] - error.pos[0] })),
    }
  }

  const hooks = new Hookable<KubbHooks>()
  const pointers = new Map<string, string>()
  hooks.hook('kubb:build:end', ({ files }) => {
    for (const source of files.flatMap((file) => file.sources)) {
      if (source.name && source.pointer) pointers.set(source.name, source.pointer)
    }
  })

  const locate = createLocator(document)
  const bundled = await bundleInput(fileName, document.toJS())
  const { input, dependencies } = bundled
  if (bundled.errors.length) {
    return {
      text: 'export {}',
      extension: '.ts',
      diagnostics: bundled.errors.map(({ message, pointer }) => {
        const range = pointer ? locate({ pointer }) : undefined
        return { messageText: message, start: range?.start ?? 0, length: range ? range.end - range.start : 0 }
      }),
      dependencies,
    }
  }

  const { text, errors } = await generateModule({
    root: dirname(fileName),
    input,
    config: keepSpecCasing(config ?? { output: { path: '.' }, plugins: [pluginTs()] }),
    hooks,
  })

  if (errors.length) {
    return {
      text: 'export {}',
      extension: '.ts',
      diagnostics: errors.map((error) => {
        const range = error.location && 'pointer' in error.location ? locate(error.location) : undefined
        return { messageText: error.message, start: range?.start ?? 0, length: range ? range.end - range.start : 0 }
      }),
      dependencies,
    }
  }

  if (config && !text) {
    return {
      text: 'export {}',
      extension: '.ts',
      diagnostics: [{ messageText: 'kubb.config.ts generated no code for this spec. Add a plugin such as pluginTs().', start: 0, length: 0 }],
      dependencies,
    }
  }

  return {
    text,
    extension: '.ts',
    mappings: createMappings(text, content, { locate: (pointer) => locate({ pointer }), locateValue: (pointer) => locate({ pointer, value: true }) }, pointers),
    dependencies,
  }
}
