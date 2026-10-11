# 设计模式

> 状态：当前规范可用。Nimi 设计模式 (`P-DESIGN-*`) 规范了跨应用的共享视觉风格与核心交互约定。

Nimi **设计模式** 由 `@nimiplatform/kit/ui` 落地并维护。它定义了 Kit UI 原语组件、语义 Design Token、主题扩展模式，以及所有接入应用共同遵循的视觉与交互契约。

## 规范基石

| 规则维度 | 对应规范与约定 |
| --- | --- |
| 权威规范 | `.nimi/spec/platform/ui-design-system.authority.yaml` |
| 机器投射配置 | `config/platform-*.yaml` |
| 受纳管的应用 | 由各 App 本地 Kit Manifest 明确声明 |
| App 自主范围 | 可自主决定组件引入方式、页面组合布局、强调色方案与界面设计语言 |
| App 禁止行为 | 禁止随意篡改共享原语组件族、重定义全局 Token 分类或破坏基础系统契约 |

## 主题方案模型 (P-DESIGN-002)

Nimi 采用“基础底色 + 品牌强调色”的分层主题架构。跨应用的基础视觉底盘保持统一稳定，应用的独特性则通过叠加的强调色包 (Accent Pack) 呈现。

| 主题层级 | 包含内容与职责 |
| --- | --- |
| 基础底色 (Base Scheme) | 全局共享的浅色/深色底色方案 (`nimi-light`, `nimi-dark`) |
| 默认强调包 (Default Accent) | 系统通用强调色方案 (`nimi-accent`) |
| 应用专属强调包 (App Accent) | 应用级自定义强调色包，在 App Spec Manifest 中声明 |

受纳管的应用在入口处按需导入：

```css
@nimiplatform/kit/ui/themes/light.css
@nimiplatform/kit/ui/themes/dark.css
@nimiplatform/kit/ui/themes/<app>-accent.css   /* 仅限引入恰好一个强调包 */
```

系统不支持混用多个强调包，也不允许跳过基础底色包单独渲染。

## 语义 Token 分类 (P-DESIGN-003)

平台共享的语义 Token 清单维护在 `config/platform-nimi-ui-tokens.yaml` 中，涵盖以下核心分类：

| 类别分类 | 典型用途与示例 |
| --- | --- |
| `surface` | 背景表面与卡片底色 |
| `text` | 文本多级颜色与透明度 |
| `action` | 交互按钮与操作反馈色 |
| `overlay` | 浮层与弹窗遮罩背景 |
| `sidebar` | 导航栏与侧边栏底色 |
| `field` | 输入框与表单控件背景/边框 |
| `status` | 成功/警示/危险/信息等状态反馈色 |
| `radius` | 统一圆角比例梯度 |
| `spacing` | 基础间距与边距尺度 |
| `typography` | 字体家族、字号梯度与字重规范 |
| `stroke` | 边框笔触线宽 |
| `elevation` | 阴影与层深高度 |
| `motion` | 动画动效时长与贝塞尔曲线缓动函数 |
| `z` | 浮层 Z-index 层级规范 |
| `sizing` | 常用控件尺寸标准 |
| `border` | 分割线与外边框颜色 |
| `opacity` | 通用不透明度尺度 |
| `focus` | 键盘焦点环高亮色 |
| `scrollbar` | 自定义滚动条槽与滑块样式 |
| `toggle` | 开关与复选框选中状态色 |
| `material` | 材质与毛玻璃质感（参阅 [Nimi UI 材质](/zh/platform/kit/nimi-ui-material)） |
| `backdrop` | 背景高斯模糊梯度 |
| `ambient` | 氛围光晕与动态着色 |

每个语义 Token 均明确归属于基础底盘 (`foundation`) 或强调层 (`accent`)。具体主题变量值在 `config/platform-nimi-ui-themes.yaml` 中定义。

应用代码严禁自行维护平行的私有 Token 注册表。

## 主题方案契约 (P-DESIGN-004)

| 规则维度 | 约束规范 |
| --- | --- |
| 当前生效方案 | 解析为 `light`（浅色）或 `dark`（深色） |
| 禁止行为 | App 禁止定义平行生效的私有主题根入口或脱离规范的根变量体系 |
| 强调包权限 | 可自由表达 App 独特的品牌色与强调风格 |
| 强调包禁忌 | 不得篡改基础底色与组件族的基本结构定义 |

## 视觉组件规范 (P-DESIGN-005)

| 规则维度 | 约束规范 |
| --- | --- |
| 变体分类依据 | `config/platform-nimi-ui-primitives.yaml` |
| 实现机制 | 在 `kit/ui` 内部采用 `cva` (Class Variance Authority) 配合 Tailwind 工具类 |
| 交互无样式内核 | 基于成熟的 Radix UI Headless 原语构建无障碍与交互逻辑 |
| 主题样式绑定 | 通过 Tailwind `@theme` 绑定由 Token 生成的 CSS 变量 |
| 组件样式消费 | 不单独生成分散的类名选择器，通过 CVA 变体参数统一消费 |
| App 自主范围 | 自由组合使用 Kit 导出的标准原语组件 |
| App 禁止行为 | 严禁在 `kit/ui` 之外针对共享组件族私自发明或重定义 CVA 变体 |

## 禁止 App 本地私自重定义组件族 (P-DESIGN-006)

| 规则维度 | 约束规范 |
| --- | --- |
| 样式表约束 | 受纳管 App 的样式表禁止针对共享原语组件定义全局覆盖类名或破坏性的 Tailwind 规则 |
| 本地包装规范 | 允许编写业务级包装组件以添加局部排版样式 |
| 视觉契约保护 | 包装组件不得破坏或颠覆共享原语既定的交互与视觉语义契约 |
| 局部扩展限制 | 自定义样式仅可作用于 App 自身拥有的私有 DOM 节点与类名 |

## 禁止 App 本地覆盖全局 Token (P-DESIGN-007)

| 规则维度 | 约束规范 |
| --- | --- |
| 变量赋值禁令 | 受纳管 App 的本地样式表严禁直接为 `--nimi-*` 全局 CSS 变量重新赋值 |
| 共享 Token 来源 | 语义 Token 仅由 `config/platform-nimi-ui-themes.yaml` 编译生成 |
| 共享代码使用规范 | 公共组件与业务组件均应通过 `var(--nimi-*)` 安全读取语义 Token |
| 兜底机制 | 避免在局部 CSS 中使用硬编码颜色或提供相互冲突的备用 Token |

## 逐步淘汰私有别名 (P-DESIGN-008)

编译生成的强调包仅输出统一的 `--nimi-*` 语义 Token。早期的私有别名前缀（如 `--ot-*`、`--color-ot-*`、`--color-brand-*`、`--color-accent-*`）属于历史过渡产物，不再作为长期标准。历史兼容样式在基础主题与强调包正常激活后将全面退役。

应用界面可通过标准语义 Token 配合本地 `color-mix(...)` 实现细致的品牌个性化表达，而不应依赖私有的别名变量来表达底色、文字、焦点等核心语义。

## 共享原语契约 (P-DESIGN-010)

共享 UI 原语组件：
- 统一由 `@nimiplatform/kit/ui` 发布导出；
- 基于 Radix UI 优秀且符合无障碍标准的 Headless 组件（Dialog、Tooltip、ScrollArea、Select、Switch、Avatar、Popover 等）；
- 通过 CVA 变体与 Tailwind 工具类引用 `--nimi-*` 语义 Token。

受纳管的应用模块在构建页面级组件时，**必须**使用以下 Shell 级基础组件族：`surface`、`action`、`overlay`、`sidebar`、`field`、`status`、`scroll_area`、`toggle`、`avatar`。应用仅可编写轻量透明的转发包装层，不得颠覆其既定视觉契约。

## 典型场景：为新应用定制专属强调包

新增的应用需要独特的品牌色调：

1. **创建强调包样式**：在 `@nimiplatform/kit/ui/themes/` 目录下新增 `<app>-accent.css`。
2. **定义强调 Token**：为规范支持的 `accent` 层语义 Token 赋予具体色值，基础底盘 Token 保持不变。
3. **引入配置**：在应用入口中按序引入基础浅色/深色 CSS 及该 App 专属的 `-accent.css`。
4. **呈现视觉风格**：应用在保持平台整体交互规范与底盘一致的前提下，完美展现其品牌识别度。

强调包仅针对现有的标准 Token 进行个性化赋值，并不需要、也不允许发明未经规范登记的私有 Token 前缀。

## 典型场景：开发者需要新增视觉变体

应用需要一种现有组件族未曾提供的按钮形态：

1. **核对规范配置**：检查 `config/platform-nimi-ui-primitives.yaml` 中已支持的变体列表。
2. **超出支持范围时**：严禁在 App 本地代码中为共享 Button 组件私加 CVA 变体枚举。
3. **合理应对路径**：若该样式具有通用性，可发起规范提案将新变体纳入官方支持；若仅属于 App 内部的孤立特化视觉，应封装为完全私有的局部组件，避免滥用共享原语命名。

## 关键设计红线

- 禁止 App 私自覆盖或篡改共享原语组件既有语义。
- 禁止在 App 本地为 `--nimi-*` 变量赋值。
- 强调色包只作用于 Accent 语义层，禁止篡改 Foundation 基础底色 Token。
- 杜绝任意自由 CSS 对公共原语组件进行全局污染。

## 规范边界速查

| 关注维度 | 规范所有者 |
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
