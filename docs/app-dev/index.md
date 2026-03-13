# App Developer Overview

Nimi gives app developers a single runtime and a single SDK (`@nimiplatform/sdk`) to work with both local and cloud AI models. Write your integration once, then switch between on-device inference and remote providers without changing application code.

## Prerequisites

- **Nimi installed and running** -- start the runtime with `nimi start`.
- **Node.js** (v18+) for the SDK.

## Quick Path

### 1. Install the SDK

```bash
npm install @nimiplatform/sdk
```

### 2. Create a Runtime instance

```ts
import { Runtime } from '@nimiplatform/sdk/runtime';

const runtime = new Runtime();
```

### 3. Generate

```ts
const result = await runtime.generate({ prompt: 'What is Nimi?' });
console.log(result.text);
```

### Minimal working example

```ts
import { Runtime } from '@nimiplatform/sdk/runtime';

const runtime = new Runtime();
const result = await runtime.generate({ prompt: 'What is Nimi?' });
console.log(result.text);
```

## Next Steps

- [SDK Setup](./sdk-setup.md) -- Install the SDK and run your first example
- [App Developer Guide](./guide.md) -- Integration patterns and scaffold
- [Recipes](./recipes.md) -- Runnable building blocks
- [Production Checklist](./production-checklist.md) -- Ship with confidence
- [SDK Reference](../reference/sdk.md) -- API surface
- [Error Codes](../reference/error-codes.md) -- Structured error handling
- [Provider Matrix](../reference/provider-matrix.md) -- Available providers
