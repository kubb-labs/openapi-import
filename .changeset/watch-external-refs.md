---
'openapi-import': patch
---

Resolve `$ref`s to other files, such as `./schemas/pet.yaml`, and watch those files. Editing one updates the types and errors in the editor without restarting the TypeScript server. A missing file shows an error on the key that points at it.

Requires `kubb` 5.14.5 or later, which bundles the `$ref` files and reports which files it read.
