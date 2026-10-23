---
'openapi-import': patch
---

Name schema types after their spec keys instead of PascalCase, so renaming a type in TypeScript renames the key and the `$ref`s that point at it.
