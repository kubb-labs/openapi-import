---
'openapi-import': patch
---

Generate code only for `openapi.yaml` and `*.openapi.yaml` specs. Other YAML files TypeScript loads through the `.yaml` extension, such as `docker-compose.yaml`, import as their parsed data in a default export instead of failing.
