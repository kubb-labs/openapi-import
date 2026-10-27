# openapi-import

Import an OpenAPI spec in TypeScript and get types for it, without generating any files.

```ts
import type { Pet } from './petStore.openapi.yaml'

const pet: Pet = { name: 'Rex', photoUrls: [], status: 'available' }
```

Autocomplete, type errors and go to definition come straight from the spec. When the spec changes, the types change with it.

> [!WARNING]
> Experimental. It needs TypeScript 7.1.0-beta or later, which adds [content mappers](https://github.com/microsoft/typescript-go/pull/4712): packages that tell the compiler how to read a file type it does not know.

## Why

Most projects turn an OpenAPI spec into TypeScript with a code generator. You run it every time the spec changes, decide whether to commit the output, and land in generated code when you go to definition.

`openapi-import` skips that step. The spec is the module you import, so there is nothing to regenerate, and the editor links every type back to its key in the spec.

## Quick start

Install it with Kubb, which generates the types, and the TypeScript beta:

```bash
pnpm add -D openapi-import kubb typescript@beta
```

Register the mapper in `tsconfig.json`:

```json
{
  "contentMappers": [{ "package": "openapi-import", "extensions": [".openapi.yaml", ".openapi.yml"] }]
}
```

Name your spec `<name>.openapi.yaml`, such as `petStore.openapi.yaml`, and import from it:

```ts
import type { GetPetByIdPath, GetPetByIdResponse, Pet } from './petStore.openapi.yaml'
```

Run the type check. TypeScript runs the mapper only with `--runExternalCode`:

```bash
tsc --noEmit --runExternalCode
```

With npm, `tsc` runs TypeScript 6. Run `node node_modules/typescript/bin/tsc` instead. VS Code only passes `--runExternalCode` in trusted workspaces.

[`examples/pet-store`](./examples/pet-store) has a working setup.

## What you can import

Each schema and operation in the spec becomes a type. Schema types keep the name of their key in the spec:

| Import                                                        | Comes from                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `Pet`                                                         | `components.schemas.Pet`                                                  |
| `Pet['name']`                                                 | `properties.name` under `Pet`, nested objects and arrays of them included |
| `orderStatusEnum`, `OrderStatusEnumKey`                       | the `status` property the enum came from                                  |
| `GetPetByIdResponse`, `GetPetByIdOptions`                     | the `get` operation under `/pet/{petId}`                                  |
| `GetPetByIdPath`, `FindPetsByStatusQuery`, `DeletePetHeaders` | the operation's `parameters`                                              |
| `GetPetByIdStatus404`                                         | `responses.404`                                                           |
| `AddPetBody`                                                  | the operation's `requestBody`                                             |

## Editor support

- Hover, go to definition and find references jump from each name in the table to its key in the spec.
- Renaming a schema type renames its key in the spec, and the `$ref`s on a property, an array item or a schema alias that point at it. Update other `$ref`s, such as inside `allOf` or a response, yourself.
- Spec errors, such as an unresolved `$ref`, show on the key they point at.
- A `$ref` to another file, such as `./schemas/pet.yaml`, is read from disk. Editing that file updates the types and errors, the same as editing the spec.
- `tsc --runExternalCode` reports the same errors in CI.

## Add Zod schemas and more

Add a `kubb.config.ts` to get more than types from the same import, such as Zod schemas from `@kubb/plugin-zod`. Any [Kubb plugin](https://kubb.dev/extensions/kind/plugins) works. List `pluginTs()` too, to keep the types:

```bash
pnpm add -D @kubb/plugin-ts @kubb/plugin-zod
pnpm add zod
```

```ts
// kubb.config.ts
import { pluginTs } from '@kubb/plugin-ts'
import { pluginZod } from '@kubb/plugin-zod'
import { defineConfig } from 'kubb/config'

export default defineConfig({
  output: { path: './src/gen' },
  plugins: [pluginTs(), pluginZod()],
})
```

Put the config next to `tsconfig.json` or in a parent folder. The editor picks up changes to it. With several configs, a spec uses the one whose `input` points at it.

## Use values at run time

`tsc` only checks types and does not emit the spec as JavaScript. Values such as `petSchema` need your bundler to load the spec. Add `kubb()` from `kubb/vite`, `kubb/webpack`, `kubb/rollup` or another entry, without a `config` option, so it reads the same `kubb.config.ts`:

```ts
// vite.config.ts
import kubb from 'kubb/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [kubb()],
})
```

The types and the values then come from the same import:

```ts
import { type GetPetByIdPath, type GetPetByIdResponse, petSchema } from './petStore.openapi.yaml'

export async function getPetById({ petId }: GetPetByIdPath): Promise<GetPetByIdResponse> {
  const response = await fetch(`https://petstore3.swagger.io/api/v3/pet/${petId}`)

  return petSchema.parse(await response.json())
}
```

Leave `input` out of the config to import specs only. With an `input`, the bundler also writes the generated files at build time. Restart the bundler after you change the config.

## Limits

- Code a plugin writes to a separate file, such as a bundled client runtime, is not included. Point imports like a client's `importPath` at a package.
- Properties of operation types don't link to the spec, and renaming one doesn't rename its key.
- Files that `kubb.config.ts` imports are not watched. Restart the TypeScript server after you change them.
- A `$ref` to a URL is not fetched and shows an error.
- `$ref` files are watched from the start for specs under the `tsconfig.json` folder. For a spec outside it, they are watched from the next time the project reloads, such as after a change to `kubb.config.ts`.
- A changed spec rebuilds all of its types: about 0.4 s for a 10 KB spec and 2.6 s for a 1.4 MB spec.

## Sponsors

`openapi-import` is part of [Kubb](https://kubb.dev), an open source project funded entirely by sponsors. If you would like to support it:

- [Become a Sponsor on GitHub](https://github.com/sponsors/stijnvanhulle)

<p align="center">
  <a href="https://github.com/sponsors/stijnvanhulle">
    <img src="https://raw.githubusercontent.com/stijnvanhulle/sponsors/main/sponsors.svg" alt="My sponsors" />
  </a>
</p>
