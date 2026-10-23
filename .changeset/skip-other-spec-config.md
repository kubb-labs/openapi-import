---
'openapi-import': patch
---

Skip a `kubb.config.ts` whose `input` points at another spec, such as one in a parent folder, so the import gets plain `@kubb/plugin-ts` types that keep the spec's property names.

- Uses `selectConfig` and `loadConfigFile` from `unplugin-kubb`, which resolve a config's paths from its own folder, the same way the Kubb CLI and bundler do.
