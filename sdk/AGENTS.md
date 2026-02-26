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
├── client.ts
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

对底层请求能力，一律走 `@nimiplatform/sdk/realm` 暴露的 `openApiRequest`。

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

## What Not To Do

- 不要新增任何 legacy 包名或兼容壳
- 不要公开 `generated/internal` 路径
- 不要跨越 `realm ↔ runtime` 私有实现边界
- 不要在公共类型签名里偷用 `Parameters<T>`/`ReturnType<T>`
