# SDK Reference

`@nimiplatform/sdk` is the unified entry point for runtime and realm integrations.

## Public surfaces

- `@nimiplatform/sdk`
- `@nimiplatform/sdk/runtime`
- `@nimiplatform/sdk/realm`
- `@nimiplatform/sdk/types`
- `@nimiplatform/sdk/ai-provider`
- `@nimiplatform/sdk/mod/*`

## Usage baseline

```ts
import { Runtime, Realm } from '@nimiplatform/sdk'
```

Use explicit construction and explicit route policy; avoid hidden global config.

## Source references

- SDK implementation guide: [`sdk/README.md`](../../sdk/README.md)
- SDK spec index: [`spec/sdk`](../../spec/sdk)
- SDK kernel tables/docs: [`spec/sdk/kernel`](../../spec/sdk/kernel)
