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
import { createPlatformClient } from '@nimiplatform/sdk';

const { runtime } = await createPlatformClient({
  appId: 'docs.sdk.reference',
});

const result = await runtime.generate({
  prompt: 'What is Nimi?',
});
```

`createPlatformClient()` is the recommended entry point for apps and examples. In Node.js it can attach to the local daemon with runtime defaults, while still giving you typed Realm access from the same SDK root. Use `@nimiplatform/sdk/runtime` or `@nimiplatform/sdk/realm` directly only when you need an explicit low-level escape hatch.

For a provider default cloud target:

```ts
const result = await runtime.generate({
  provider: 'gemini',
  prompt: 'What is Nimi?',
});
```

The high-level convenience surface treats `model` as a local or provider-scoped model id. Fully-qualified remote model ids stay on the lower-level `runtime.ai.text.generate(...)` surface.

## Source references

- SDK implementation guide: [`sdk/README.md`](https://github.com/nimiplatform/nimi/blob/main/sdk/README.md)
- SDK spec index: [`spec/sdk`](https://github.com/nimiplatform/nimi/blob/main/spec/sdk/index.md)
- SDK kernel tables/docs: [`spec/sdk/kernel`](https://github.com/nimiplatform/nimi/blob/main/spec/sdk/kernel/index.md)
