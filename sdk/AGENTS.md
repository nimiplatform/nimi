# SDK AGENTS.md

> Conventions for AI agents working on `@nimiplatform/sdk` (TypeScript).

## Context

SDK 已收敛为**单包模型**：仅发布 `@nimiplatform/sdk`，通过稳定子路径暴露能力。

- 物理包：`sdk`
- 对外导入面：`@nimiplatform/sdk/*`
- 不存在 legacy split 包导入面（历史多包命名已全部下线）

## Source Layout

```
sdk/src/
├── index.ts
├── realm/
├── runtime/
├── types/
├── scope/
├── mod/
└── ai-provider/
```

## Import Rules

Allowed:

```ts
import { ... } from '@nimiplatform/sdk';
import { ... } from '@nimiplatform/sdk/realm';
import { ... } from '@nimiplatform/sdk/runtime';
import { ... } from '@nimiplatform/sdk/types';
import { ... } from '@nimiplatform/sdk/scope';
import { ... } from '@nimiplatform/sdk/mod/*';
import { ... } from '@nimiplatform/sdk/ai-provider';
```

Forbidden:

```ts
import { ... } from '@nimiplatform/sdk/internal/...';
import { ... } from '@nimiplatform/sdk/generated/...';
import { ... } from '@nimiplatform/sdk/realm/core/...';
import { ... } from '@nimiplatform/sdk/realm/models/...';
import { ... } from '@nimiplatform/sdk/realm/services/...';
```

对底层请求能力，一律走 `new Realm(...).raw.request(...)`。

## Test Placement

Tests live in `sdk/test/` mirroring the `sdk/src/` directory structure. For example, `sdk/src/runtime/` tests are in `sdk/test/runtime/`. Live smoke tests are in `sdk/test/runtime/contract/providers/`.

## Generated Directories (READ-ONLY)

- `sdk/src/runtime/generated/` — TypeScript protobuf client generated from `proto/runtime/v1/`. Never edit manually; regenerate with `buf generate` from the `proto/` directory.
- `sdk/src/realm/generated/` — TypeScript realm client generated from backend OpenAPI spec. Never edit manually; regenerate with `pnpm generate:realm-sdk`.

## TypeScript Rules

- ESM only，`.ts` 文件导入使用 `.js` 后缀
- `strict: true` + `noImplicitAny: true`
- Public API 禁止 `any`（必要时使用显式泛型或 `unknown`）
- 运行时校验使用 `zod.safeParse`
- 生产代码禁止 `console.log`

## Naming Rules (Public Surface)

- 公共符号禁止 `2fa/2Fa/2FA` 混用，统一 `TwoFactor`
- 禁止公开 legacy 命名：
  - `Me2FaService`
  - `Auth2faVerifyDto`
  - `Me2faVerifyDto`
  - `Me2faPrepareResponseDto`
  - `SocialV1DefaultVisibilityService`
  - `SocialFourDimensionalAttributesService`
- realm 公开层通过 facade 暴露规范命名：
  - `MeTwoFactorService`
  - `AuthTwoFactorVerifyInput`
  - `MeTwoFactorVerifyInput`
  - `MeTwoFactorPrepareOutput`
  - `SocialDefaultVisibilityService`
  - `SocialAttributesService`

## ReasonCode Rules

- `reasonCode` 必须使用 `ReasonCode` 常量，禁止字面量
- 码值必须 `UPPER_SNAKE_CASE`
- 禁止重复 key/value，key 与 value 必须一致

示例：

```ts
import { ReasonCode } from '@nimiplatform/sdk/types';

if (err.reasonCode === ReasonCode.AI_PROVIDER_TIMEOUT) {
  // retry
}
```

## CI / Gate Commands

- `pnpm check:sdk-import-boundary`
- `pnpm check:sdk-single-package-layout`
- `pnpm check:sdk-public-naming`
- `pnpm check:reason-code-constants`
- `pnpm check:scope-catalog-drift`
- `pnpm check:runtime-bridge-method-drift`
- `pnpm check:sdk-coverage`
- `pnpm check:sdk-consumer-smoke`
- `pnpm --filter @nimiplatform/sdk test`

### Live Smoke Tests

SDK live tests validate the full SDK → runtime gRPC → cloud provider chain. They live in `test/runtime/contract/providers/nimi-sdk-ai-provider-live-smoke.test.ts`.

Tests use `withRuntimeDaemon` to spawn a real runtime process, then call SDK's `doGenerate` through the gRPC transport. They auto-skip when `NIMI_SDK_LIVE !== '1'` or when required env vars are missing.

**Env var convention:**

- `NIMI_SDK_LIVE=1` — master switch to enable SDK live tests
- `NIMI_LIVE_{PROVIDER}_API_KEY` — provider API key (same vars as runtime live tests)
- `NIMI_LIVE_{PROVIDER}_MODEL_ID` — model ID for generate text
- `NIMI_RUNTIME_CLOUD_{PROVIDER}_*` — passed to the runtime daemon process

**Running:**

```bash
# All skip (no NIMI_SDK_LIVE)
npx tsx --test sdk/test/runtime/contract/providers/nimi-sdk-ai-provider-live-smoke.test.ts

# Enable with specific provider
NIMI_SDK_LIVE=1 NIMI_LIVE_OPENAI_API_KEY=sk-xxx NIMI_LIVE_OPENAI_MODEL_ID=gpt-4o-mini \
  npx tsx --test sdk/test/runtime/contract/providers/nimi-sdk-ai-provider-live-smoke.test.ts
```

**Adding a new provider SDK live test:**

1. Add a `test('nimi sdk ai-provider live smoke: {provider} generate text', ...)` block following the existing pattern
2. Use `requiredEnvOrSkip(t, 'NIMI_LIVE_{PROVIDER}_API_KEY')` for the API key
3. Pass `NIMI_RUNTIME_CLOUD_{PROVIDER}_BASE_URL` and `NIMI_RUNTIME_CLOUD_{PROVIDER}_API_KEY` to `withRuntimeDaemon`
4. Ensure the provider's env binding exists in `runtime/internal/services/ai/provider.go` → `cloudProviderEnvBindings`

## What Not To Do

- 不要新增任何 legacy 包名或兼容壳
- 不要公开 `generated/internal` 路径
- 不要跨越 `realm ↔ runtime` 私有实现边界
- 不要在公共类型签名里偷用 `Parameters<T>`/`ReturnType<T>`
