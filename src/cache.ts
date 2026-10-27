import { readFileSync } from 'node:fs'
import type { UserConfig } from 'kubb'
import type { TransformParams, TransformResult } from './transform.ts'

/**
 * The text of `file`, or `null` when it cannot be read.
 */
export const readOrNull = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * Wraps a transform so a repeated request for the same file, content and config returns the
 * previous result. TypeScript asks again for specs it already transformed (another project, a
 * reload, a changed file next to the spec), and a Kubb build of a large spec takes seconds. A
 * result whose `dependencies` changed on disk, the files its external `$ref`s read, is
 * transformed again. A failed transform is not kept.
 */
export function cacheTransform<TResult extends Pick<TransformResult, 'text' | 'dependencies'>>(
  transform: (params: TransformParams, config?: UserConfig) => Promise<TResult>,
): (params: TransformParams, config?: UserConfig) => Promise<TResult> {
  const results = new Map<string, { content: string; config?: UserConfig; result: Promise<TResult> }>()

  const run = (params: TransformParams, config?: UserConfig) => {
    const result = transform(params, config)
    results.set(params.fileName, { content: params.content, config, result })
    result.catch(() => results.delete(params.fileName))
    return result
  }

  return async (params, config) => {
    const cached = results.get(params.fileName)
    // A reloaded config is a new object, so comparing by reference catches every config change.
    if (!cached || cached.content !== params.content || cached.config !== config) return run(params, config)

    const result = await cached.result
    const fresh = Object.entries(result.dependencies ?? {}).every(([file, text]) => readOrNull(file) === text)
    return fresh ? result : run(params, config)
  }
}
