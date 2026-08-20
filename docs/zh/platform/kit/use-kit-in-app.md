# 在 App 中使用 Kit

当 App 需要共享 Nimi UI、auth、shell glue、telemetry、AI capability configuration 或可复用 feature surface 时，使用 `@nimiplatform/kit`。App 代码应该通过 `kit/package.json` 里的公开 subpath 导入 Kit；不要导入 `kit/**/src`，也不要在 App 本地复制 Kit 已经拥有的能力。

## 安装

生成的 Nimi App scaffold 已经依赖 Kit。如果一个 standalone App 还没有 Kit，把它和 SDK 一起安装：

```bash
pnpm add @nimiplatform/kit @nimiplatform/sdk
```

Kit 要求 React 19。`react-dom`、`react-i18next` 和 `electron` 是特定 subpath 使用的 peer dependency。

## 公开导入组

| 需要 | 从哪里导入 |
| --- | --- |
| 共享 UI primitives、themes、accessibility、motion | `@nimiplatform/kit/ui`、`@nimiplatform/kit/ui/a11y`、`@nimiplatform/kit/ui/motion`、已列出的 theme CSS exports |
| Runtime account login 与 auth UI | `@nimiplatform/kit/auth` |
| 纯逻辑 helper | 已枚举的 `@nimiplatform/kit/core/...` subpaths |
| 标准 shell renderer bridge | `@nimiplatform/kit/shell/renderer/bridge`、`@nimiplatform/kit/shell/renderer/bootstrap` |
| Electron host bridge | `@nimiplatform/kit/shell/electron/main`、`@nimiplatform/kit/shell/electron/preload` |
| Telemetry 与 error boundary | `@nimiplatform/kit/telemetry`、`@nimiplatform/kit/telemetry/error-boundary` |
| Agent Center、chat、avatar、generation、commerce | 已枚举的 `@nimiplatform/kit/features/...` subpaths |

Kit 不发布 wildcard subpaths。完整公开导入清单以 `kit/package.json` 的 `exports` 对象为准。

## UI 和主题

```ts
import { Button, IconButton, Dialog, cn } from '@nimiplatform/kit/ui';
import { VISUALLY_HIDDEN_CLASS_NAME, VISUALLY_HIDDEN_STYLE } from '@nimiplatform/kit/ui/a11y';
import { usePrefersReducedMotion } from '@nimiplatform/kit/ui/motion';
```

```css
@import '@nimiplatform/kit/ui/styles.css';
@import '@nimiplatform/kit/ui/themes/light.css';
@import '@nimiplatform/kit/ui/themes/nimi-accent.css';
```

应用一个 base theme（`light.css` 或 `dark.css`），并按需叠加 Nimi accent overlay。不要在 App CSS 里重新定义 Kit token 名称。

## Shell 和 Auth

Renderer app code 使用 renderer-safe shell exports：

```ts
import { invokeTauri } from '@nimiplatform/kit/shell/renderer/bridge';
import { resolveBootstrapAuthSession } from '@nimiplatform/kit/shell/renderer/bootstrap';
```

Electron main/preload code 使用 Electron-only exports：

```ts
import { createElectronRuntimeBridgeCommandNames } from '@nimiplatform/kit/shell/electron/main';
import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload';
```

不要从 renderer app code 导入 Electron host modules。不要在 shell code 里调用 Runtime private API；shell bridge 保持 SDK 和 standard capability boundary。

## AI Capability Configuration

Agent Center 通过公开 feature 展示 owner-scoped AIConfig intent：

```ts
import {
  AgentCenter,
  AgentCenterAIConfigSection,
} from '@nimiplatform/kit/features/agent-center/ui';
import { createNimiAppAIConfigClient } from '@nimiplatform/sdk/ai';
```

负责配置的 session 提供当前完整 AIConfig 和 overwrite action。这个 section 让 owner 表达 Local 或 Cloud capability intent，不选择 model、machine route、connector 或 execution binding。具体实现选择、readiness 和 execution evidence 归 Runtime 管理。

## 复用规则

- 写 App 本地 UI primitives、auth flows、shell glue、telemetry、AI capability configuration、chat shell、avatar stage、generation panels 或 commerce surfaces 前，先检查 Kit。
- 只使用公开 subpath exports。如果需要的共享行为只存在于 `kit/**/src`，先给 Kit 增加公开 export，再让 App 消费。
- App-specific layout 和 product workflow 留在 App。
- Runtime execution semantics 留在 Runtime 和 SDK 调用里。

## 验证

在本仓库：

```bash
pnpm --filter @nimiplatform/kit build
pnpm --filter @nimiplatform/kit test
pnpm check:nimi-kit
```

在生成的 App 仓库：

```bash
pnpm run validate
pnpm run doctor
```

## 来源依据

- [`kit/README.md`](https://github.com/nimiplatform/nimi/blob/main/kit/README.md)
- [`kit/package.json`](https://github.com/nimiplatform/nimi/blob/main/kit/package.json)
- [`.nimi/spec/platform/ui-design-system.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ui-design-system.authority.yaml)
- [`apps/lab/src/lab/lab-ai-config-store.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-ai-config-store.ts)
