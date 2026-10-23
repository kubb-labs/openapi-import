import { defineConfig } from 'oxfmt'

export default defineConfig({
  printWidth: 160,
  tabWidth: 2,
  useTabs: false,
  trailingComma: 'all',
  semi: false,
  singleQuote: true,
  bracketSameLine: false,
  endOfLine: 'lf',
  ignorePatterns: ['**/dist/**', '**/coverage/**', '**/CHANGELOG.md', 'pnpm-lock.yaml'],
})
