# openapi-import

## 0.0.6

### Patch Changes

- [#18](https://github.com/kubb-labs/openapi-import/pull/18) [`c4e709a`](https://github.com/kubb-labs/openapi-import/commit/c4e709a523ebec6c987d26eb1975d94547763db3) Thanks [@stijnvanhulle](https://github.com/stijnvanhulle)! - Depend on `unplugin-kubb` 5.15. The `kubb` peer range stays at `^5.14.5`.

## 0.0.5

### Patch Changes

- [#15](https://github.com/kubb-labs/openapi-import/pull/15) [`e3f02a0`](https://github.com/kubb-labs/openapi-import/commit/e3f02a04004d68c22c1860f0fd060becb467c375) Thanks [@stijnvanhulle](https://github.com/stijnvanhulle)! - Resolve `$ref`s to other files, such as `./schemas/pet.yaml`, and watch those files. Editing one updates the types and errors in the editor without restarting the TypeScript server. A missing file shows an error on the key that points at it.
  
  Requires `kubb` 5.14.5 or later, which bundles the `$ref` files and reports which files it read.

## 0.0.4

### Patch Changes

- [#12](https://github.com/kubb-labs/openapi-import/pull/12) [`b8b1ab6`](https://github.com/kubb-labs/openapi-import/commit/b8b1ab640553c383b68ad993758c44a1e888e8bf) Thanks [@stijnvanhulle](https://github.com/stijnvanhulle)! - Link generated types to the spec through the pointer Kubb sets on each declaration, instead of guessing the spec key from the type name. Types from every plugin in the config are linked, not only `@kubb/plugin-ts` ones.

## 0.0.3

### Patch Changes

- [#10](https://github.com/kubb-labs/openapi-import/pull/10) [`348b7b0`](https://github.com/kubb-labs/openapi-import/commit/348b7b0937287ce3665dd80fb95105eb38cb919a) Thanks [@stijnvanhulle](https://github.com/stijnvanhulle)! - Skip a `kubb.config.ts` whose `input` points at another spec, such as one in a parent folder, so the import gets plain `@kubb/plugin-ts` types that keep the spec's property names.

## 0.0.2

### Patch Changes

- [#6](https://github.com/kubb-labs/openapi-import/pull/6) [`a5cf08b`](https://github.com/kubb-labs/openapi-import/commit/a5cf08b7b987860146642a4669cd64cae4f6515c) Thanks [@stijnvanhulle](https://github.com/stijnvanhulle)! - Name schema types after their spec keys instead of PascalCase, so renaming a type in TypeScript renames the key and the `$ref`s that point at it.

## 0.0.1

### Patch Changes

- [`9835f7e`](https://github.com/kubb-labs/openapi-import/commit/9835f7ef204218ec578a7f164e3b278e2084522a) Thanks [@claude](https://github.com/claude)! - Add `openapi-import`, a TypeScript 7.1 content mapper. Import an OpenAPI spec and get the code the plugins in your `kubb.config.ts` generate, without generated files.
