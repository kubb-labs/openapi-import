# openapi-import

Import an OpenAPI spec in TypeScript and get the code the plugins in your `kubb.config.ts` generate, without generated files.

```ts
import { type Pet, petSchema } from './petStore.openapi.yaml'
```

It is a [TypeScript content mapper](https://github.com/microsoft/typescript-go/pull/4712): TypeScript 7.1 type-checks the output of every plugin in your config in place of the spec.

> [!WARNING]
> Experimental. It needs TypeScript 7.1.0-beta or later with `--runExternalCode`. TypeScript does not emit the spec to JavaScript, so values such as `petSchema` only exist at run time when a bundler loads the spec with [`unplugin-kubb`](https://github.com/kubb-labs/kubb/tree/main/packages/unplugin-kubb).

## Setup

```bash
pnpm add -D kubb openapi-import typescript@beta @kubb/plugin-ts
```

With npm, `tsc` runs TypeScript 6, because `@typescript/typescript6` links its `tsc` over the one from `typescript`. Run `node node_modules/typescript/bin/tsc` instead.

Register the `.openapi.yaml` extension in `tsconfig.json`. A plain `.yaml` would also send files such as `docker-compose.yaml` to the mapper, and `.json` can't be mapped.

```json
{
  "contentMappers": [{ "package": "openapi-import", "extensions": [".openapi.yaml", ".openapi.yml"] }]
}
```

Add the plugins you want to `kubb.config.ts`, and install them, such as `@kubb/plugin-zod` and `zod`:

```ts
import { pluginTs } from '@kubb/plugin-ts'
import { pluginZod } from '@kubb/plugin-zod'
import { defineConfig } from 'kubb/config'

export default defineConfig({
  output: { path: './src/gen' },
  plugins: [pluginTs(), pluginZod()],
})
```

The mapper finds the config like the Kubb CLI does and reloads it when it changes. With several configs, a spec uses the one whose `input` matches it. Without a config, only `@kubb/plugin-ts` runs.

For values at run time, add `kubb()` from `kubb/vite` or another bundler entry, without a `config` option, so it reads the same `kubb.config.ts` as `tsc`. A config with an `input` also writes the generated files at build time, so leave it out to import specs only.

Run the type check:

```bash
tsc --noEmit --runExternalCode
```

VS Code only passes `--runExternalCode` in trusted workspaces.

## Editor support

Go to definition, find references and hover link generated names to their keys in the spec. Renaming a schema type named like its key, such as `Pet`, renames the key too. Update the `$ref`s to it yourself.

| Generated name                                                | Jumps to                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `Pet`                                                         | `components.schemas.Pet`                                                  |
| `Pet['name']`                                                 | `properties.name` under `Pet`, nested objects and arrays of them included |
| `orderStatusEnum`, `OrderStatusEnumKey`                       | the `status` property the enum came from                                  |
| `GetPetByIdResponse`, `GetPetByIdOptions`                     | the `get` operation under `/pet/{petId}`                                  |
| `GetPetByIdPath`, `FindPetsByStatusQuery`, `DeletePetHeaders` | the operation's `parameters`                                              |
| `GetPetByIdStatus404`                                         | `responses.404`                                                           |
| `AddPetBody`                                                  | the operation's `requestBody`                                             |

Spec errors, such as an unresolved `$ref`, show on the key they point at. See [`examples/pet-store`](./examples/pet-store) for a working setup.

## Limits

- Code a plugin writes to a separate file, such as a bundled client runtime, is not included. Point imports like the client's `importPath` at a package.
- Properties of operation types don't link to the spec, and renaming a property doesn't rename its key.
- Files that `kubb.config.ts` imports are not watched. Restart the TypeScript server after you change them.
- A changed spec runs a full Kubb build: about 0.4 s for a 10 KB spec and 2.6 s for a 1.4 MB spec.

## Supporting Kubb

Kubb is an open source project, and its development is funded entirely by sponsors. If you would like to become a sponsor, please consider:

- [Become a Sponsor on GitHub](https://github.com/sponsors/stijnvanhulle)

<p align="center">
  <a href="https://github.com/sponsors/stijnvanhulle">
    <img src="https://raw.githubusercontent.com/stijnvanhulle/sponsors/main/sponsors.svg" alt="My sponsors" />
  </a>
</p>
