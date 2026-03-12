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
import { Runtime } from '@nimiplatform/sdk/runtime';

const runtime = new Runtime();

const result = await runtime.generate({
  prompt: 'What is Nimi?',
});
```

Node.js consumers can use `new Runtime()` with local daemon defaults. Use explicit transport when you are outside Node.js or when you need a non-default endpoint.

For a provider default cloud target:

```ts
const result = await runtime.generate({
  provider: 'gemini',
  prompt: 'What is Nimi?',
});
```

The high-level convenience surface treats `model` as a local or provider-scoped model id. Fully-qualified remote model ids stay on the lower-level `runtime.ai.text.generate(...)` surface.

## Source references

- SDK implementation guide: [`sdk/README.md`](../../sdk/README.md)
- SDK spec index: [`spec/sdk`](../../spec/sdk)
- SDK kernel tables/docs: [`spec/sdk/kernel`](../../spec/sdk/kernel)
