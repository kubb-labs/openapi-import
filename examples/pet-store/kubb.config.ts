import { pluginTs } from '@kubb/plugin-ts'
import { pluginZod } from '@kubb/plugin-zod'
import { defineConfig } from 'kubb/config'

// openapi-import runs these plugins for every imported `.yaml` spec and merges their output.
export default defineConfig({
  input: './openapi.yaml',
  output: { path: './src/gen' },
  plugins: [pluginTs({ arrayType: 'generic' }), pluginZod()],
})
