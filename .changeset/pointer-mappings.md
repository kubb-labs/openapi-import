---
'openapi-import': patch
---

Link generated types to the spec through the pointer Kubb sets on each declaration, instead of guessing the spec key from the type name. Types from every plugin in the config are linked, not only `@kubb/plugin-ts` ones.
