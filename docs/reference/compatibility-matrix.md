# Compatibility Matrix

Use this matrix before upgrading production systems.

| Layer | Compatibility rule |
|---|---|
| SDK vs Runtime | Keep within the same `major.minor` train |
| SDK vs Desktop/Web | Pin workspace release set for each app release |
| Proto vs Runtime | Proto contract drift is not supported |

## Verification commands

```bash
pnpm check:sdk-version-matrix
pnpm check:runtime-bridge-method-drift
pnpm check:scope-catalog-drift
```
