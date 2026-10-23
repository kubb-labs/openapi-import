# openapi-import

## 0.0.2

### Patch Changes

- [#6](https://github.com/kubb-labs/openapi-import/pull/6) [`a5cf08b`](https://github.com/kubb-labs/openapi-import/commit/a5cf08b7b987860146642a4669cd64cae4f6515c) Thanks [@stijnvanhulle](https://github.com/stijnvanhulle)! - Name schema types after their spec keys instead of PascalCase, so renaming a type in TypeScript renames the key and the `$ref`s that point at it.

## 0.0.1

### Patch Changes

- [`9835f7e`](https://github.com/kubb-labs/openapi-import/commit/9835f7ef204218ec578a7f164e3b278e2084522a) Thanks [@claude](https://github.com/claude)! - Add `openapi-import`, a TypeScript 7.1 content mapper. Import an OpenAPI spec and get the code the plugins in your `kubb.config.ts` generate, without generated files.
