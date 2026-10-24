import { dirname } from 'node:path'
import ts from '@typescript/typescript6'
import type { UserConfig } from 'kubb'
import { Hookable, type KubbHooks } from 'kubb/kit'
import { pluginTs, pluginTsName, resolverTs } from '@kubb/plugin-ts'
import { generateModule } from 'unplugin-kubb'
import { parseDocument } from 'yaml'
import { createLocator } from './locate.ts'
import { createMappings, type Segment } from './mappings.ts'

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

  const { text, errors } = await generateModule({
    root: dirname(fileName),
    input: document.toJS(),
    config: keepSpecCasing(config ?? { output: { path: '.' }, plugins: [pluginTs()] }),
    hooks,
  })

  const locate = createLocator(document)

  if (errors.length) {
    return {
      text: 'export {}',
      extension: '.ts',
      diagnostics: errors.map((error) => {
        const range = error.location && 'pointer' in error.location ? locate(error.location) : undefined
        return { messageText: error.message, start: range?.start ?? 0, length: range ? range.end - range.start : 0 }
      }),
    }
  }

  if (config && !text) {
    return {
      text: 'export {}',
      extension: '.ts',
      diagnostics: [{ messageText: 'kubb.config.ts generated no code for this spec. Add a plugin such as pluginTs().', start: 0, length: 0 }],
    }
  }

  return {
    text,
    extension: '.ts',
    mappings: createMappings(text, content, { locate: (pointer) => locate({ pointer }), locateValue: (pointer) => locate({ pointer, value: true }) }, pointers),
  }
}
