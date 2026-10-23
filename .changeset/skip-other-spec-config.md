---
'openapi-import': patch
---

Skip a `kubb.config.ts` whose `input` points at another spec, such as one in a parent folder, so the import gets plain `@kubb/plugin-ts` types that keep the spec's property names.
