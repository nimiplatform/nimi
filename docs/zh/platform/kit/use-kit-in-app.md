# 在 App 中使用 Kit

当应用需要接入 Nimi 标准 UI、用户认证、Shell 宿主胶水、遥测、AI 配置界面或可复用的业务功能表面时，推荐使用 `@nimiplatform/kit`。

应用代码应始终通过 `kit/package.json` 中声明的公开子路径导入 Kit；切勿直接导入内部源码路径（如 `kit/**/src`），也不要在本地重复实现 Kit 已成熟支持的公共能力。

## 安装与依赖

通过官方脚手架创建的 Nimi App 已默认预置 Kit 依赖。若是为已有独立项目引入，请与 SDK 一同安装：

```bash
pnpm add @nimiplatform/kit @nimiplatform/sdk
```

Kit 核心基于 React 19 构建。`react-dom`、`react-i18next` 与 `electron` 作为可选 Peer Dependencies，仅在引入特定子路径时按需安装。

## 公开导入子路径速查

| 业务诉求 | 推荐导入路径 |
| --- | --- |
| 共享 UI 原语、主题方案、无障碍支持、动画动效 | `@nimiplatform/kit/ui`、`@nimiplatform/kit/ui/a11y`、`@nimiplatform/kit/ui/motion` 及指定的主题 CSS 文件 |
| Runtime 账户登录与用户认证交互组件 | `@nimiplatform/kit/auth` |
| 宿主无关的纯逻辑与辅助工具函数 | `@nimiplatform/kit/core/...` 公开子路径 |
| 标准 Shell 渲染层桥接与引导模块 | `@nimiplatform/kit/shell/renderer/bridge`、`@nimiplatform/kit/shell/renderer/bootstrap` |
| Electron 宿主进程桥接 | `@nimiplatform/kit/shell/electron/main`、`@nimiplatform/kit/shell/electron/preload` |
| 遥测上报与 React 错误边界 (Error Boundary) | `@nimiplatform/kit/telemetry`、`@nimiplatform/kit/telemetry/error-boundary` |
| Agent Center、聊天、数字人、多模态生成、应用商业化组件 | `@nimiplatform/kit/features/...` 对应功能子路径 |

Kit 不对外暴露通配符 (Wildcard) 导出，完整的可用子路径请以 `kit/package.json` 中的 `exports` 配置为准。

## 引入 UI 组件与主题

在 React 组件中消费标准 UI 原语：

```ts
import { Button, IconButton, Dialog, cn } from '@nimiplatform/kit/ui';
import { VISUALLY_HIDDEN_CLASS_NAME, VISUALLY_HIDDEN_STYLE } from '@nimiplatform/kit/ui/a11y';
import { usePrefersReducedMotion } from '@nimiplatform/kit/ui/motion';
```

在应用入口样式表中引入主题：

```css
@import '@nimiplatform/kit/ui/styles.css';
@import '@nimiplatform/kit/ui/themes/light.css';
@import '@nimiplatform/kit/ui/themes/nimi-accent.css';
```

通常引入一个基础底色主题（`light.css` 或 `dark.css`），并根据需求叠加应用专属的强调色包。请勿在应用样式中私自覆盖 Kit 的 `--nimi-*` 全局变量命名。

## Shell 桥接与认证接入

在渲染进程 (Renderer) 代码中，使用渲染安全的 Shell 导出：

```ts
import {
  createNimiLocalAppStandardShellSurface,
  installNimiShellRuntimeBridge,
} from '@nimiplatform/kit/shell/renderer/bridge';
import { createRendererEntryModuleLoader } from '@nimiplatform/kit/shell/renderer/bootstrap';
```

标准渲染层入口通常初始化调用一次 `installNimiShellRuntimeBridge()`。`createNimiLocalAppStandardShellSurface()` 负责为宿主绑定的 SDK Client 提供标准 Shell 实现，Client 随后通过 `createNimiClient({ localApp: { standardShell } })` 完成组装。更底层的 `invokeShell` 与 `invokeTauri` 属于 Shell 适配层内部胶水，日常业务代码无需直接调用。

在 Electron 主进程 (Main) 与预加载脚本 (Preload) 中，使用专用导出：

```ts
import { createElectronRuntimeBridgeCommandNames } from '@nimiplatform/kit/shell/electron/main';
import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload';
```

切勿在渲染进程中导入 Electron 宿主模块；亦不可在 Shell 适配层中直接穿透调用 Runtime 私有底层 API。

## AI 能力配置面板

应用可直接接入标准模型配置组件，展示并管理 AI 参数：

```ts
import { ModelConfigAIConfigSurface } from '@nimiplatform/kit/features/model-config';
```

标准设置面板会自动将 `client.aiConfig.get()`、`client.aiConfig.listOptions(query)` 与 `client.aiConfig.overwrite(input)` 绑定至交互界面：

- **本地能力 (Local)**：仅保存路由标记，自动复用当前设备为该能力配置的本地模型组 (Loadout)。
- **云端能力 (Cloud)**：用户可从 Runtime 安全选项中为当前账号选择合规的 Connector 与授权目标模型，并将确切的 `connectorRef`、`implementation` 与 `providerModelTarget` 保存至 AIConfig。
- **职责划分**：这是持久化的配置选择，而非每次推理执行时的动态覆盖；Runtime 会在提交时校验并固化输入配置，模型就绪状态与实际推理执行依然分别独立判定。详见 [AI 配置](/zh/sdk/ai-config-surface)。

Agent Center 亦通过 `@nimiplatform/kit/features/agent-center/ui` 导出的 `AgentCenterAIConfigSection` 提供同款配置能力。

## 复用与集成规范

- 在手写 App 本地 UI 原语、用户认证流、Shell 胶水、AI 设置面板或聊天对话框前，请先核对 Kit 是否已提供开箱即用支持。
- 严格遵循公开子路径导出。若所需通用能力仍藏在 `kit/**/src` 内，应先在 Kit 中定义合规导出，再在应用中规范引用。
- 业务特有的页面排版、交互文案与业务决策严格保留在 App 内部。
- 底层推理语义与执行逻辑保留在 Runtime 与 SDK 中。

## 本地编译与检查验证

在 Nimi 根仓库运行：

```bash
pnpm --filter @nimiplatform/kit build
pnpm --filter @nimiplatform/kit test
pnpm check:nimi-kit
```

在生成的独立 App 仓库中运行：

```bash
pnpm run check
pnpm run test
```

## Source Basis

- [`kit/README.md`](https://github.com/nimiplatform/nimi/blob/main/kit/README.md)
- [`kit/package.json`](https://github.com/nimiplatform/nimi/blob/main/kit/package.json)
- [`.nimi/spec/platform/ui-design-system.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ui-design-system.authority.yaml)
- [`apps/lab/src/lab/lab-ai-config-store.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-ai-config-store.ts)
