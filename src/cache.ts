import type { UserConfig } from '@kubb/core'
import type { TransformParams } from './transform.ts'

/**
 * Wraps a transform so a repeated request for the same file, content and config returns the
 * previous result. TypeScript asks again for specs it already transformed (another project, a
 * reload), and a Kubb build of a large spec takes seconds. A failed transform is not kept.
 */
export function cacheTransform<TResult>(
  transform: (params: TransformParams, config?: UserConfig) => Promise<TResult>,
): (params: TransformParams, config?: UserConfig) => Promise<TResult> {
  const results = new Map<string, { content: string; config?: UserConfig; result: Promise<TResult> }>()

  return (params, config) => {
    const cached = results.get(params.fileName)
    // A reloaded config is a new object, so comparing by reference catches every config change.
    if (cached && cached.content === params.content && cached.config === config) return cached.result

    const result = transform(params, config)
    results.set(params.fileName, { content: params.content, config, result })
    result.catch(() => results.delete(params.fileName))
    return result
  }
}
