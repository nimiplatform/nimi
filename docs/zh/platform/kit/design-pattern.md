# 设计模式

> 状态：运行中 (Running)。Nimi 设计模式 (`P-DESIGN-*`) 是
> 用于共享视觉和交互约定的跨应用权威。

Nimi **设计模式** 是位于 `@nimiplatform/nimi-kit/ui` 中的共享视觉和交互权威。它管理 kit primitives、语义令牌、主题 schema，以及任何消费方 app 接入时必须遵守的通用契约。

## 基础权威

| 规则 | 值 |
| --- | --- |
| 权威规范 | `.nimi/spec/platform/kernel/design-pattern-contract.md` |
| 权威表格 | `.nimi/spec/platform/kernel/tables/` |
| 管理的消费方 | 由各 app 本地 kit manifest 声明 |
| 应用本地 spec 可以 | 拥有具体 adoption 清单、app-owned compositions、accent 选择和艺术指导 |
| 应用本地 spec 不可以 | 重新定义共享 primitive 家族、令牌分类或治理规则 |

## 主题包模型 (P-DESIGN-002)

共享的设计基础在各个应用之间是**恒定**的。应用的身份通过叠加在其上的强调包来体现。

| 层 | 提供的内容 |
| --- | --- |
| 基础方案 | 共享的浅色/深色方案 (`nimi-light`, `nimi-dark`) |
| 共享强调包 | `nimi-accent` |
| 消费方强调包 | 可选，由消费方 app spec manifest 拥有 |

受管理的应用条目导入：

```
@nimiplatform/nimi-kit/ui/themes/light.css
@nimiplatform/nimi-kit/ui/themes/dark.css
@nimiplatform/nimi-kit/ui/themes/<app>-accent.css   （恰好一个）
```

没有“混合两个强调包”的模式，也没有“跳过基础方案”的模式。

## 语义令牌分类 (P-DESIGN-003)

共享的语义令牌位于 `tables/nimi-ui-tokens.yaml` 中。已准入的令牌类别包括：

| 类别 | 示例 |
| --- | --- |
| `surface` | 背景色调 |
| `text` | 文本色调 |
| `action` | 动作/按钮色调 |
| `overlay` | 叠加表面 |
| `sidebar` | 侧边栏色调 |
| `field` | 表单字段色调 |
| `status` | 状态色调 |
| `radius` | 圆角半径 |
| `spacing` | 间距比例 |
| `typography` | 字体 + 大小 + 字重 |
| `stroke` | 笔画权重 |
| `elevation` | 高度令牌 |
| `motion` | 动画持续时间 + 缓动 |
| `z` | Z-index 比例 |
| `sizing` | 组件大小令牌 |
| `border` | 边框色调 |
| `opacity` | 不透明度比例 |
| `focus` | 焦点环色调 |
| `scrollbar` | 滚动条色调 |
| `toggle` | 切换色调 |
| `material` | 材质令牌（参见 [Nimi UI Material](/platform/kit/nimi-ui-material)） |
| `backdrop` | 背景模糊令牌 |
| `ambient` | 环境效果色调 |

每个语义令牌声明其属于 `foundation` 或 `accent` 层令牌。主题包值位于 `tables/nimi-ui-themes.yaml` 中。

应用代码不得为受管理的表面创建并行的令牌注册表。

## 主题方案契约 (P-DESIGN-004)

| 规则 | 值 |
| --- | --- |
| 解析的方案状态 | `light` 或 `dark` |
| 应用不可以定义 | 并行的应用本地主题入口点或根令牌系统 |
| 强调包可以 | 表达产品身份 |
| 强调包不可以 | 重新定义基本家族结构 |

## 基本视觉权威 (P-DESIGN-005)

| 规则 | 值 |
| --- | --- |
| 变体分类权威 | `tables/nimi-ui-primitives.yaml` |
| 实现模式 | CVA（类方差权威）+ Tailwind 工具类在 `kit/ui` 内 |
| 行为原语 | Radix UI 无头原语 |
| 主题注册 | 通过 Tailwind `@theme` 在生成的 CSS 中使用语义令牌 |
| 原语 CSS 类选择器 | 不单独生成；CVA 组合 |
| 应用/共享库代码可以 | 组合共享原语 |
| 应用/共享库代码不可以 | 在 `kit/ui` 之外为共享原语家族定义 CVA 变体 |

## 不允许应用本地重新定义原语 (P-DESIGN-006)

| 规则 | 值 |
| --- | --- |
| 受管理的应用样式表不可以 | 定义针对共享原语家族的 CVA 变体或 Tailwind 工具类覆盖 |
| 应用本地包装器可以 | 添加组合类名 |
| 应用本地包装器不可以 | 重新定义共享原语的视觉契约 |
| 受控例外可以 | 仅对应用拥有的选择器进行样式设置 |

## 不允许应用本地令牌覆盖 (P-DESIGN-007)

| 规则 | 值 |
| --- | --- |
| 受管理的应用样式表不可以 | 为 `--nimi-*` CSS 变量赋值 |
| 共享语义令牌值 | 仅来自从 `tables/nimi-ui-themes.yaml` 生成的主题 CSS |
| 共享库手写 CSS 可以 | 读取语义令牌 |
| 共享库手写 CSS 不可以 | 提供备用令牌权威 |

## 强调别名逐步淘汰 (P-DESIGN-008)

生成的强调包仅发出共享的 `--nimi-*` 语义令牌值。应用范围的别名命名空间（`--ot-*`, `--color-ot-*`, `--color-brand-*`, `--color-accent-*`）不是长期权威。已退役的应用特定全主题兼容输出在基础加强调激活后不能保留在生成的共享库主题表面上。

受管理的应用界面可以通过共享语义令牌和本地 `color-mix(...)` 表达式来分层应用身份，但不能通过应用范围的强调别名来表示共享背景/文本/焦点/表面含义。

## 共享原语契约 (P-DESIGN-010)

共享原语：

- 由 `@nimiplatform/nimi-kit/ui` 提供
- 基于 Radix UI 无头原语（Dialog, Tooltip, ScrollArea, Select, Switch, Avatar, Popover）
- 使用 CVA + Tailwind 引用 `--nimi-*` 语义令牌进行样式设置

受管理的应用模块**必须**使用共享原语进行壳级家族：`surface`, `action`, `overlay`, `sidebar`, `field`, `status`, `scroll_area`, `toggle`, `avatar`。仅允许直接委托给 `@nimiplatform/nimi-kit/ui` 的薄兼容包装器，且不重新定义视觉契约。

## 读者场景：为新应用添加强调包

一个新的准入 Nimi 应用需要自己的强调身份。

1. **添加强调包。** 新的 `<app>-accent.css` 文件将放置在 `@nimiplatform/nimi-kit/ui/themes/` 下。
2. **令牌被覆盖。** 强调包为已准入的 `accent` 层语义令牌分配值；基础令牌保持不变。
3. **应用导入。** 应用入口导入基础浅色 + 深色 CSS 以及恰好其自身的 `-accent.css`。
4. **视觉身份显现。** 应用感觉独特，同时共享基础方案。

强调包没有发明新的令牌命名空间。它为已准入的令牌赋值。

## 读者场景：模组作者想要一个新的视觉变体

模组作者希望有一个与任何已准入的共享原语变体都不匹配的按钮变体。

1. **首先检查变体表。** `tables/nimi-ui-primitives.yaml` 声明了已准入的变体。
2. **如果变体不在其中：** 模组不能在应用本地代码中为共享原语家族定义新的 CVA 变体。
3. **选项：** 提议为共享原语新增一个已准入的变体（治理流程），或者使用一个不持有相同原语名称的自定义应用本地组件。

边界保持共享原语契约的真实性。

## 设计模式不做的事情

- 它不允许每个应用重新定义共享原语。
- 它不允许每个应用覆盖 `--nimi-*` 令牌。
- 它不允许强调包更改基础令牌。
- 它不允许自由形式的 CSS 对共享原语家族声称权威。

## 边界摘要

| 关注点 | 权威 |
| --- | --- |
| 基础权威 | `P-DESIGN-001` |
| 主题包模型 | `P-DESIGN-002` |
| 语义令牌分类 | `P-DESIGN-003` + `tables/nimi-ui-tokens.yaml` |
| 主题方案契约 | `P-DESIGN-004` |
| 基本视觉权威 | `P-DESIGN-005` + `tables/nimi-ui-primitives.yaml` |
| 应用本地重新定义规则 | `P-DESIGN-006`, `P-DESIGN-007`, `P-DESIGN-008` |
| 共享原语契约 | `P-DESIGN-010` |

## 来源依据

- [`.nimi/spec/platform/kernel/design-pattern-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/design-pattern-contract.md)
- [`.nimi/spec/platform/kernel/tables/nimi-ui-tokens.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/nimi-ui-tokens.yaml)
- [`.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml)
- [`.nimi/spec/platform/kernel/tables/nimi-ui-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/nimi-ui-primitives.yaml)
- [`.nimi/spec/platform/kernel/kit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/kit-contract.md)
