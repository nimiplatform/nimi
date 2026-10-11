# Nimi UI 材质规范

> 规范状态：正式生效契约；公开能力由 Design/Runtime 规范接口对外暴露。

根据 `P-DESIGN-022` 规范，Nimi 确立了标准五级材质分类，并在 `config/platform-nimi-ui-tokens.yaml` 中发布了完整的 Token 目录。性能降级 Hook 接口已在规范层面作为预留设计标准化；具体材质降级由 Kit 与宿主渲染表面结合显式透明度策略处理。

## 什么是“材质” (Material)

在 Nimi 设计模式中，**材质** 描述了组件表面的物理光感与质感处理：包括不透明度、高斯背景模糊程度，以及其与底层视觉内容的对比关系。

材质是独立于色彩色相的一个正交维度：你可以拥有一个 `solid` 纯色的操作按钮、一个 `glass-thick` 较厚的浮动面板，或是一个 `glass-chrome` 系统级的覆盖层——这些材质形态与其语义颜色（如主色、危险色）互不冲突、自由正交。

材质体系采用**严谨的封闭式五级分类**，任何应用或业务模块均不得在外部发明平行的材质体系。

## 标准五级材质分类

按不透明度与模糊强度递增排列：

| 层级 | 背景 Token | 边框 Token | 背景模糊梯度 |
| --- | --- | --- | --- |
| `solid` | 通过 `surface.*` 底色家族解析（无额外材质背景/边框） | — | — |
| `glass-thin` | `material.glass_thin.bg` (`--nimi-material-glass-thin-bg`) | `material.glass_thin.border` | `backdrop.blur_thin` |
| `glass-regular` | `material.glass_regular.bg` | `material.glass_regular.border` | `backdrop.blur_regular` |
| `glass-thick` | `material.glass_thick.bg` | `material.glass_thick.border` | `backdrop.blur_strong` |
| `glass-chrome` | `material.glass_chrome.bg` | `material.glass_chrome.border` | `backdrop.blur_chrome` |

系统内建的模糊半径梯度精确映射到 `blur_thin / blur_regular / blur_strong / blur_chrome`。

这套五级分类完整演进并取代了早期的三级模式（`solid` / `glass-regular` / `glass-thick`），在保证向下兼容的基础上新增了 `glass-thin` 与 `glass-chrome`。

## 开发者规范

| 规则要求 | 约束等级 |
| --- | --- |
| 通过 `@nimiplatform/kit/ui` 导出的 `<Surface material="...">` 原语组件或 `data-nimi-material="<tier>"` 标记类消费材质 | 强制遵循 |
| 严禁在内联样式中使用硬编码的 `rgba(...)` 材质背景 | 严格禁止 |
| 严禁手写内联 `backdrop-filter` 样式声明 | 严格禁止 |
| 严禁脱离 Kit 规范而在 Tailwind 中随意拼装未经验证的 `backdrop-blur-*` 类名 | 严格禁止 |
| 严禁在强调色包 (Accent Pack) 中覆盖 `material.*` 或 `backdrop.*` 基础 Token | 严格禁止（材质属于全局中立底盘） |
| 自行添加第六级自定义材质 | 需提交官方规范提案（不支持私有扩展） |

统一采用 `<Surface>` 原语组件能够保证材质效果在各应用界面中保持一致规范。

## 各材质层级的设计初衷

每个材质层级均服务于特定的界面信息层级与可读性诉求：

| 层级 | 核心应用场景与设计意图 |
| --- | --- |
| `solid` | 高对比度界面，像素级清晰度至关重要（表单输入、复杂密集数据表） |
| `glass-thin` | 轻量级悬停卡片与轻度叠加层，保持界面的呼吸感与空间连贯性 |
| `glass-regular` | 标准玻璃态表面，适用于常规抽屉、浮动侧边栏与多数悬浮菜单 |
| `glass-thick` | 较厚重的高对比度玻璃表面，用于需要压制底层复杂动效的场景（如背景动画之上的弹窗） |
| `glass-chrome` | 最高强度的玻璃处理，专用于系统框架级表面 (Chrome surfaces，如应用顶栏、命令面板) |

该分类具有明确的设计主见 (Opinionated)。开发者不可随意混搭非标准的模糊半径来拼凑临时视觉效果。

## 性能降级 Hook 接口

毛玻璃模糊滤镜对客户端 GPU 存在一定的计算开销。设计规范预留了性能降级 Hook 接口：当运行在低配终端设备或需要节能时，具体的宿主渲染表面可按接口定义将高开销层级回退为低开销层级。具体的降级行为由宿主/渲染表面实现承接，规范层面定义该接口以确保应用获得一致的降级体验。

需要强调的是，性能降级**不会改变**组件本身的声明契约，它仅在运行时动态调整实际解析的材质层级。例如，声明为 `glass-chrome` 的组件在低算力设备上可能会以 `glass-regular` 甚至纯色渲染，而业务组件的声明代码无需做任何修改。

## 无障碍对比度保障

设计规范严格锁定了材质层级与标准文字/边框色系之间的无障碍 (a11y) 对比度阈值。选择材质层级时，必须确保文本可读性始终高于既定阈值；如遇到极端特殊场景，应走规范既有的对比度补偿机制，而不是发明未经审核的私有材质。

## 典型场景：弹窗选择适配的材质层级

应用需要在一个包含动态背景粒子动画的画布上方弹出模态框：

1. **明确视觉意图**：模态框需要压制底层动画干扰，保证弹窗文本极佳的可读性，选择 `glass-thick`。
2. **声明原语组件**：使用 `<Surface material="glass-thick">...</Surface>`。
3. **样式自动绑定**：背景和边框自动绑定 `material.glass_thick.*`，背景模糊精准匹配 `backdrop.blur_strong`。
4. **自适应降级**：若设备处于低算力或节能状态，宿主表面可将渲染层级回退（如以 `glass-regular` 呈现），弹窗内容始终清晰可读。

开发者仅需声明 `material="glass-thick"`，后续的渲染管线与变量解析均由平台底层机制统一承接。

## 典型场景：规范拦截手写内联模糊样式

某业务模块开发者在自定义面板中尝试编写内联样式 `style=\{\{ background: 'rgba(...)', backdropFilter: 'blur(20px)' \}\}`：

1. **静态扫描与代码拦截**：开发检查工具将捕获违规的手写内联材质与滤镜代码。
2. **调整为规范原语**：改用标准的 `<Surface material="glass-regular">` 或适配当前层级的规范组件。
3. **视觉一致性保障**：面板视觉效果与平台其他界面浑然一体，并自动获得主题切换与性能降级支持。

## 典型场景：提出新增材质层级诉求

设计师在特定界面场景中希望引入一种全新的视觉模糊规格：

1. **规范防收敛发散**：核心规范采用封闭枚举，禁止直接在应用端随意扩充第六级材质。
2. **走标准化流程**：向设计规范委员会提交提案，评估新模糊梯度的合理性，通过后统一定义在 `config/platform-nimi-ui-tokens.yaml`，并同步更新 `<Surface>` 原语与降级测试用例。
3. **官方发布消费**：新层级经官方发布后，全体应用即可统一合规使用。

这种边界约束是必要的防线：不受控的随意扩展会让设计系统迅速演变为难以维护的样式碎片。

## 关键设计红线

- 强调色包 (Accent Pack) 严禁覆盖基础材质 Token。
- 严禁手写内联模糊滤镜与透明度样式。
- 严禁在规范之外随意发明未经验证的模糊数值。
- 严禁在未经标准化评审前私自扩展材质层级。
- 性能降级仅作用于运行时渲染解析，不改变开发者的声明式组件接口。

## 规范边界速查

| 关注维度 | 规范所有者 |
| --- | --- |
| 五级材质分类与 Token 架构 | `P-DESIGN-022` |
| Token 完整目录 | `config/platform-nimi-ui-tokens.yaml` |
| 主题预设具体值 | `config/platform-nimi-ui-themes.yaml` |
| `<Surface>` 原语组件 | `@nimiplatform/kit/ui` |
| 性能降级规范接口 | `P-DESIGN-022`（规范定义） |
| 降级执行与透明度策略 | Kit 与宿主渲染表面 |

## Source Basis

- [`.nimi/spec/platform/ui-design-system.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ui-design-system.authority.yaml)
- [`config/platform-nimi-ui-tokens.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-nimi-ui-tokens.yaml)
- [`config/platform-nimi-ui-themes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-nimi-ui-themes.yaml)
