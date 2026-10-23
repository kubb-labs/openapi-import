---
'openapi-import': patch
---

Skip a `kubb.config.ts` whose `input` points at another spec, such as one in a parent folder, so the import gets plain `@kubb/plugin-ts` types that keep the spec's property names.

- Resolves a config's `root` and `input` from the folder the config belongs to, not from the TypeScript server's working directory.
