import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { UserConfig } from 'kubb'
import { configFileCandidates, findConfigFile, loadConfigFile } from 'unplugin-kubb'

/**
 * A Kubb config found for a TypeScript project, with what TypeScript needs to reload it.
 */
export type ProjectConfig = {
  /**
   * The folder the config file was found for, which can be a parent of the project. Kubb resolves
   * a config's `root` and `input` from here, as the CLI does when it runs from that folder.
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
  let configDir = dir
  while (!configFileCandidates(configDir).includes(file)) configDir = dirname(configDir)
  try {
    const configs = await loadConfigFile<UserConfig>(file, {})
    // `defineConfig` fills in a missing `root` with the cwd of this server, not the config's folder.
    const withRoot = configs.map((config) => ({ ...config, root: config.root === process.cwd() ? configDir : resolve(configDir, config.root || '.') }))
    return { dir: configDir, configs: withRoot, watchedFiles, identity }
  } catch (error) {
    return { dir: configDir, configs: [], watchedFiles, identity, error: `${file} failed to load: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * The config for one spec: the one whose `input` is that spec, else the first without an `input`.
 * A config whose `input` is another spec, such as a parent project's `kubb.config.ts`, does not
 * apply, so the spec gets plain `@kubb/plugin-ts` instead of that project's plugins.
 */
export function selectSpecConfig(configs: Array<UserConfig>, fileName: string, dir: string): UserConfig | undefined {
  const isSpec = (config: UserConfig) => typeof config.input === 'string' && resolve(dir, config.root || '.', config.input) === resolve(fileName)

  return configs.find(isSpec) ?? configs.find((config) => config.input === undefined)
}
