# 平台工具包

> 状态：运行中 (Running)。`@nimiplatform/nimi-kit` 是跨应用共享平台基础设施 (`P-KIT-001..P-KIT-099`) 的单一包权威。

**平台工具包**是跨表面层，包含设计令牌、基本元素、基础模块、功能模块、逻辑模块和基础设施模块，这些模块被受管理的应用程序所使用。它是对“共享的视觉+交互语言在哪里？”这个问题的回答。

工具包是一个单一的包。每个 Nimi 应用程序通过子路径导入来访问它。应用程序不会重复工具包已经涵盖的内容。

## 包权威

| 规则 | 值 |
| --- | --- |
| 权威包 | `@nimiplatform/nimi-kit`（单一） |
| 子路径导出 | `/ui`, `/auth`, `/core/*`, `/telemetry/*`, `/features/*` |
| 源位置 | 仓库根目录下的 `kit/`，与 `apps/`, `sdk/`, `runtime/` 同级 |
| 子模块工作区清单 | 不允许（单个工作区包） |
| 应用程序可以复制工具包的功能吗？ | 不可以 |

希望发布的工具包子模块必须在 `tables/nimi-kit-registry.yaml` 中注册，并声明 `subpath`, `kind`（`foundation` / `feature` / `logic` / `infra`），`dependencies`, `peer_dependencies`, `exports`, `admission_status`, `owner`。新的子模块在任何消费者可以导入之前进行注册。

## 模块种类

| 种类 | 目的 | 示例 |
| --- | --- | --- |
| `foundation` | 令牌 + 基本元素 + 主题（工具包的基础） | `ui` (`@nimiplatform/nimi-kit/ui`) |
| `feature` | 有界功能表面（组件 + 钩子 + 适配器在一个公共表面上） | `auth` (`@nimiplatform/nimi-kit/auth`) |
| `logic` | 纯逻辑实用工具（无 UI / 无 CSS） | `core` (`@nimiplatform/nimi-kit/core/*`) |
| `infra` | 基础设施：遥测、错误边界、主机粘合剂 | `telemetry`, `shell/tauri` |

## 层边界

| 层 | 允许的导入 | 禁止的导入 |
| --- | --- | --- |
| 工具包子模块 | 根据声明的依赖关系导入其他工具包子模块 | 应用层代码 (`apps/**`)；运行时内部 (`runtime/internal/**`) |
| 应用 | 通过已准入的子路径导入工具包 | 绕过公共子路径的工具包内部路径 |

`kit/shell/tauri/**` 作为一个非 npm Rust crate 被准入，并通过 Cargo 路径依赖消费。它没有 `package.json` 导出，也没有独立的工作区包清单。

## 工具包拥有什么

| 关注点 | 子模块 |
| --- | --- |
| 设计令牌 + 基本元素 + 主题（视觉基础） | `ui` |
| 认证组件 + 钩子 + 存储 + 适配器 | `auth` |
| 共享环境 / 功能检测 / OAuth 辅助工具 | `core` |
| 渲染端遥测 + 错误边界 | `telemetry` |
| Tauri 主机粘合剂（运行时桥接、守护进程生命周期、会话日志、OAuth 命令） | `shell/tauri` |

有关设计语言深度，请参阅[设计模式](/platform/kit/design-pattern)。
有关材料令牌目录，请参阅[Nimi UI 材料](/platform/kit/nimi-ui-material)。

## 工具包不拥有什么

- 每个应用的布局（每个应用以自己的方式组合工具包的基本元素）
- 应用特定的用户体验或产品流程
- 运行时语义权威（这些是运行时/认知合同）
- 领域真相
- 后端执行

工具包提供构建块。应用程序进行组装。

## 读者场景：一个消费方希望按钮看起来正确

一个消费方应用希望它的 UI 符合共享的 Nimi 交互语言。

1. **使用工具包的基本元素。** 模块导入 `@nimiplatform/nimi-kit/ui` 以获取共享的 `<Button>`, `<Surface>`, `<Dialog>` 等。
2. **使用语义令牌。** 组件消耗 `--nimi-*` CSS 自定义属性；不要重新定义它们。
3. **主题遵循共享方案。** 模块从 `@nimiplatform/nimi-kit/ui/themes/*-accent.css` 导入共享的浅色/深色 CSS 以及恰好一个应用强调包。
4. **视觉一致性。** 消费方 UI 自动继承已准入的基本元素和令牌。

消费方没有重新定义按钮变体，而是组合已准入的基本元素。

## 读者场景：一个应用添加了一个已经在工具包中存在的功能

一个应用需要处理 OAuth 流程。

1. **首先检查工具包。** `@nimiplatform/nimi-kit/auth` 提供认证组件 + 钩子，通过 `AuthPlatformAdapter` 参数化。
2. **注入适配器。** 应用提供特定于平台的适配器（native shell / browser）。
3. **使用工具包的表面。** 应用不从头开始实现 OAuth。

这条规则（P-KIT-001）确保了接口范围的可控：工具包的任务是防止 N 个应用各自编写自己的认证。

## 读者场景：添加一个新的工具包子模块

维护者希望添加一个新的共享子模块。

1. **首先注册。** 在 `tables/nimi-kit-registry.yaml` 中添加一行，包含所需字段和 `admission_status`。
2. **选择一种类型。** `foundation` / `feature` / `logic` / `infra`。
3. **在 `kit/<subpath>` 下添加源代码。** 单个工作区包；没有独立的清单。
4. **消费者可以导入。** 只有在注册后；边界得到强制执行。

子模块不能发布隐秘的、未记录的表面区域。

## 工具包不做什么

- 它不允许应用程序重新定义其基本元素或令牌。
- 它不允许 N 个并行的设计系统。
- 它不消费应用层代码。
- 它不消费运行时内部代码。
- 它不允许提供商特定或应用特定的用户体验泄露到共享的基本元素中。

## 边界摘要

| 关注点 | 所有者 |
| --- | --- |
| 单一包权威 + 子路径注册表 | `P-KIT-001..P-KIT-002` |
| 源位置 + 边界 | `P-KIT-003` |
| 基础/功能/逻辑/基础设施模块种类 | `P-KIT-010..P-KIT-041` |
| 设计模式（视觉+交互合同） | `P-DESIGN-*`（单独页面） |
| 材料分类法+令牌 | `nimi-ui-material-contract.md`（单独页面） |

## 来源依据

- [`.nimi/spec/platform/kernel/kit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/kit-contract.md)
- [`.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml)
- [`.nimi/spec/platform/kernel/design-pattern-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/design-pattern-contract.md)
- [`.nimi/spec/platform/kernel/nimi-ui-material-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/nimi-ui-material-contract.md)
