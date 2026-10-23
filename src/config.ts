import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { UserConfig } from 'kubb'
import { configFileCandidates, findConfigFile, loadConfigFile } from 'unplugin-kubb'

/**
 * A Kubb config found for a TypeScript project, with what TypeScript needs to reload it.
 */
export type ProjectConfig = {
  /**
   * The project folder.
   */
  dir: string
  /**
   * The configs the file exports, empty when there is no config file.
   */
  configs: Array<UserConfig>
  /**
   * The config file, plus every file the CLI would pick up in `dir`, so adding one reloads too.
   */
  watchedFiles: Array<string>
  /**
   * Changes when the config file changes, so TypeScript transforms its specs again.
   */
  identity: string
  /**
   * Why the config file failed to load. Each transform reports it on the spec.
   */
  error?: string
}

/**
 * Finds the Kubb config the way the Kubb CLI does, from `dir` up, and loads it. A config that
 * exports a function is called with no CLI options.
 */
export async function loadProjectConfig(dir: string): Promise<ProjectConfig> {
  dir = resolve(dir)
  const file = findConfigFile(dir)
  const watchedFiles = [...new Set([...(file ? [file] : []), ...configFileCandidates(dir)])]
  if (!file) return { dir, configs: [], watchedFiles, identity: 'none' }

  const identity = createHash('sha256').update(readFileSync(file)).digest('hex')
  try {
    return { dir, configs: await loadConfigFile<UserConfig>(file, {}), watchedFiles, identity }
  } catch (error) {
    return { dir, configs: [], watchedFiles, identity, error: `${file} failed to load: ${error instanceof Error ? error.message : String(error)}` }
  }
}
