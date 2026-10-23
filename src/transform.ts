import { dirname } from 'node:path'
import type { UserConfig } from 'kubb'
import { Hookable, type KubbHooks } from 'kubb/kit'
import { pluginTs } from '@kubb/plugin-ts'
import { generateModule } from 'unplugin-kubb'
import { parseDocument } from 'yaml'
import { createLocator } from './locate.ts'
import { createMappings, type Segment, type Targets } from './mappings.ts'

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
  const targets: Targets = { schemas: new Map(), operations: new Map() }
  hooks.hook('kubb:generate:schema', (node, { resolver }) => {
    if (node.name) targets.schemas.set(resolver.name(node.name), node.name)
  })
  hooks.hook('kubb:generate:operation', (node, { resolver }) => {
    if ('path' in node && node.path && node.method) targets.operations.set(resolver.name(node.operationId), { path: node.path, method: node.method })
  })

  const { text, errors } = await generateModule({
    root: dirname(fileName),
    input: document.toJS(),
    config: config ?? { output: { path: '.' }, plugins: [pluginTs()] },
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

  return { text, extension: '.ts', mappings: createMappings(text, content, (pointer) => locate({ pointer }), targets) }
}
