# 设计模式

> 状态：规范已生效。Nimi 设计模式 (`P-DESIGN-*`) 规范了跨应用的一致视觉基础与交互契约。

Nimi 设计模式由 `@nimiplatform/kit/ui` 维护并落地，定义了 Kit UI 原语组件、语义 Design Token、主题扩展模式，以及所有接入应用共同遵循的视觉与交互基线。

## 规范基线

| 维度 | 对应规范与约定 |
| --- | --- |
| 权威规范 | `.nimi/spec/platform/ui-design-system.authority.yaml` |
| 投射配置 | `config/platform-*.yaml` |
| 受管应用 | 由各 App 本地 Kit Manifest 声明 |
| App 自主范围 | 自由组织组件结构、页面布局、强调色配置与专属界面表达 |
| 平台约束 | 不得私自篡改共享原语组件、重定义全局 Token 分类或破坏基础系统契约 |

## 主题分层模型 (P-DESIGN-002)

Nimi 采用“基础底色 + 品牌强调色”的分层主题架构。跨应用的基础视觉底盘保持统一稳定，应用专属特征则通过强调色包 (Accent Pack) 独立表达。

| 主题层级 | 职责与内容 |
| --- | --- |
| 基础底色 (Base Scheme) | 全局共享的浅色与深色底色方案 (`nimi-light`, `nimi-dark`) |
| 默认强调包 (Default Accent) | 系统通用强调色方案 (`nimi-accent`) |
| 应用专属强调包 (App Accent) | 应用自定义强调色包，在 App Spec Manifest 中声明 |

受管应用在入口处按需导入对应样式：

```css
@nimiplatform/kit/ui/themes/light.css
@nimiplatform/kit/ui/themes/dark.css
@nimiplatform/kit/ui/themes/<app>-accent.css   /* 仅限引入恰好一个强调包 */
```

系统不支持同时混用多个强调包，也不允许脱离基础底色包单独渲染强调包。

## 语义 Token 分类 (P-DESIGN-003)

共享语义 Token 清单在 `config/platform-nimi-ui-tokens.yaml` 中统一定义，涵盖以下核心分类：

| 分类 | 典型用途与示例 |
| --- | --- |
| `surface` | 背景表面与卡片底色 |
| `text` | 多级文本颜色与透明度 |
| `action` | 交互按钮与操作反馈色 |
| `overlay` | 浮层与弹窗遮罩背景 |
| `sidebar` | 导航栏与侧边栏底色 |
| `field` | 输入框与表单控件背景/边框 |
| `status` | 成功/警示/危险/信息等状态反馈色 |
| `radius` | 统一圆角梯度 |
| `spacing` | 基础间距与边距尺度 |
| `typography` | 字体家族、字号梯度与字重规范 |
| `stroke` | 边框笔触线宽 |
| `elevation` | 阴影与层深高度 |
| `motion` | 动画时长与贝塞尔曲线缓动函数 |
| `z` | 浮层 Z-index 层级规范 |
| `sizing` | 常用控件尺寸标准 |
| `border` | 分割线与外边框颜色 |
| `opacity` | 通用不透明度尺度 |
| `focus` | 键盘焦点环高亮色 |
| `scrollbar` | 自定义滚动条槽与滑块样式 |
| `toggle` | 开关与复选框选中状态色 |
| `material` | 材质与高斯模糊质感（参阅 [Nimi UI 材质](/zh/platform/kit/nimi-ui-material)） |
| `backdrop` | 背景高斯模糊梯度 |
| `ambient` | 氛围光晕与动态着色 |

每个语义 Token 均明确归属于基础底盘 (`foundation`) 或强调层 (`accent`)。具体主题变量值由 `config/platform-nimi-ui-themes.yaml` 编译生成。

应用代码不得自行维护平行的私有 Token 注册表。

## 主题生效契约 (P-DESIGN-004)

| 维度 | 契约约束 |
| --- | --- |
| 当前生效方案 | 解析为 `light`（浅色）或 `dark`（深色） |
| 根变量约束 | App 不得定义平行生效的私有主题根入口或脱离规范的根变量体系 |
| 强调包权限 | 允许自由表达 App 独特的品牌色与强调风格 |
| 强调包约束 | 不得覆盖基础底色或破坏组件族的基本结构定义 |

## 视觉原语规范 (P-DESIGN-005)

| 维度 | 契约约束 |
| --- | --- |
| 变体分类依据 | `config/platform-nimi-ui-primitives.yaml` |
| 实现机制 | 在 `kit/ui` 内部采用 `cva` (Class Variance Authority) 配合 Tailwind 工具类 |
| 无样式内核 | 基于 Radix UI Headless 原语构建无障碍与交互逻辑 |
| 主题样式绑定 | 通过 Tailwind `@theme` 绑定由 Token 生成的 CSS 变量 |
| 组件样式消费 | 不单独生成分散的类名选择器，通过 CVA 变体参数统一消费 |
| App 自主范围 | 自由组合使用 Kit 导出的标准原语组件 |
| App 约束 | 严禁在 `kit/ui` 之外针对共享组件族私自发明或重定义 CVA 变体 |

## 组件族重定义限制 (P-DESIGN-006)

| 维度 | 契约约束 |
| --- | --- |
| 样式表约束 | 受管 App 的样式表禁止针对共享原语组件定义全局覆盖类名或破坏性的 Tailwind 规则 |
| 本地包装规范 | 允许编写业务级包装组件以添加局部排版样式 |
| 交互契约保护 | 包装组件不得破坏或颠覆共享原语既定的交互与视觉语义契约 |
| 作用域限制 | 自定义样式仅可作用于 App 自身拥有的局部 DOM 节点与私有类名 |

## 全局 Token 覆盖约束 (P-DESIGN-007)

| 维度 | 契约约束 |
| --- | --- |
| 变量赋值限制 | 受管 App 本地样式表禁止直接为 `--nimi-*` 全局 CSS 变量重新赋值 |
| Token 权威来源 | 语义 Token 仅由 `config/platform-nimi-ui-themes.yaml` 编译输出 |
| Token 读取规范 | 共享组件与业务代码均应通过 `var(--nimi-*)` 安全读取语义 Token |
| 颜色兜底 | 避免在局部 CSS 中使用硬编码色值或注入相互冲突的备用 Token |

## 已退役的私有别名 (P-DESIGN-008)

编译输出的强调包仅提供统一的 `--nimi-*` 语义 Token。早期的私有别名前缀（如 `--ot-*`、`--color-ot-*`、`--color-brand-*`、`--color-accent-*`）已退役，不得继续生成或作为共享视觉语义的来源。

应用如需细化品牌个性，应使用标准语义 Token 配合本地 `color-mix(...)` 处理，避免依赖私有别名变量来表达底色、文字或焦点等核心语义。

## 共享原语契约 (P-DESIGN-010)

共享 UI 原语组件：
- 统一由 `@nimiplatform/kit/ui` 发布导出；
- 基于 Radix UI 构建，保障无障碍标准（涵盖 Dialog、Tooltip、ScrollArea、Select、Switch、Avatar、Popover 等）；
- 通过 CVA 变体与 Tailwind 工具类引用 `--nimi-*` 语义 Token。

受管应用在构建页面级组件时，**必须**使用以下 Shell 级基础组件族：`surface`、`action`、`overlay`、`sidebar`、`field`、`status`、`scroll_area`、`toggle`、`avatar`。应用可编写轻量透明的业务包装层，但不得破坏既定的视觉契约。

## 典型场景：为新应用定制专属强调包

应用需要体现专属品牌色调时的标准流程：

1. **声明强调包**：在受管主题输入中声明由 App 拥有的强调色值，通过生成流程产出 `@nimiplatform/kit/ui/themes/<app>-accent.css`。
2. **配置强调 Token**：为规范支持的 `accent` 层语义 Token 赋予具体色值，保持基础底盘 Token 不变。
3. **引入主题配置**：在应用入口按顺序引入基础浅色/深色 CSS 及该 App 专属的 `<app>-accent.css`。
4. **呈现品牌识别**：应用在与平台整体底盘和交互规范保持一致的同时，呈现专属品牌视觉。

强调包仅对现有标准 Token 进行品牌赋值，无需也不能自行引入未经登记的私有 Token 前缀。

## 典型场景：开发者需要新增视觉变体

现有共享组件族缺少所需的按钮形态时的处理路径：

1. **核对规范配置**：查阅 `config/platform-nimi-ui-primitives.yaml` 中已支持的变体列表。
2. **边界控制**：严禁在 App 本地代码中直接为共享 Button 组件私增 CVA 变体枚举。
3. **选择合理路径**：共享组件族的新变体需纳入 Kit 的正式契约与实现。App 可以组合现有原语完成业务布局，但不能通过重命名私有包装组件绕过共享契约。

## 关键设计红线

- 禁止 App 私自覆盖或篡改共享原语组件的既有语义。
- 禁止在 App 本地代码中为 `--nimi-*` 变量赋值。
- 强调色包仅作用于 Accent 语义层，禁止修改 Foundation 基础底色 Token。
- 禁止使用非受控的全局 CSS 污染公共原语组件。

## 规范边界速查

| 维度 | 规范所有者 |
| --- | --- |
| 整体设计基石 | `P-DESIGN-001` |
| 主题分层模型 | `P-DESIGN-002` |
| 语义 Token 分类标准 | `P-DESIGN-003` + `config/platform-nimi-ui-tokens.yaml` |
| 主题生效方案契约 | `P-DESIGN-004` |
| 视觉原语实现体系 | `P-DESIGN-005` + `config/platform-nimi-ui-primitives.yaml` |
| 本地重定义与覆盖禁令 | `P-DESIGN-006`, `P-DESIGN-007`, `P-DESIGN-008` |
| 共享原语核心契约 | `P-DESIGN-010` |

## Source Basis

- [`.nimi/spec/platform/ui-design-system.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ui-design-system.authority.yaml)
- [`config/platform-nimi-ui-tokens.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-nimi-ui-tokens.yaml)
- [`config/platform-nimi-ui-themes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-nimi-ui-themes.yaml)
- [`config/platform-nimi-ui-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-nimi-ui-primitives.yaml)
