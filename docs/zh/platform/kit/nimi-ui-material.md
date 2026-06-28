# Nimi UI 材质

## 状态：已准入契约；公开使用以 design/runtime 暴露面为准

`P-DESIGN-022` 下的五级材质分类已被准入，并且令牌目录已在 `tables/nimi-ui-tokens.yaml` 中发布。性能降级钩子接口在规范层面已被准入；运行时侧性能降级行为必须通过 design/runtime 暴露面使用。

## 什么是“材质”

在 Nimi 设计模式中，**材质** 描述了组件的表面处理方式：它的不透明度、背景模糊程度以及它与背后内容的对比度。材质是一个独立于颜色色调的轴；你可以有一个 `solid` 动作按钮、一个 `glass-thick` 面板、一个 `glass-chrome` 覆盖层——这些都与其语义颜色角色无关。

材质是一个**封闭的五级分类**。任何应用、模块或功能模块不得创建平行的材质轴。

## 五级分类

按不透明度/模糊强度递增顺序排列：

| 层级 | 背景令牌 | 边框令牌 | 背景模糊 |
| --- | --- | --- | --- |
| `solid` | 通过 `surface.*` 色调家族解析（无材质背景/边框令牌） | — | — |
| `glass-thin` | `material.glass_thin.bg` (`--nimi-material-glass-thin-bg`) | `material.glass_thin.border` | `backdrop.blur_thin` |
| `glass-regular` | `material.glass_regular.bg` | `material.glass_regular.border` | `backdrop.blur_regular` |
| `glass-thick` | `material.glass_thick.bg` | `material.glass_thick.border` | `backdrop.blur_strong` |
| `glass-chrome` | `material.glass_chrome.bg` | `material.glass_chrome.border` | `backdrop.blur_chrome` |

模糊半径梯度映射到 `blur_thin / blur_regular / blur_strong / blur_chrome`。

五级分类取代了之前的三级形式（`solid` / `glass-regular` / `glass-thick`）。原始层级名称保持不变；`glass-thin` 和 `glass-chrome` 是新增加的层级。

## 消费者规则

| 规则 | 是否必须 |
| --- | --- |
| 通过 `@nimiplatform/kit/ui` 中的 `<Surface material="...">` 原始组件消费材质，或使用等效的 `data-nimi-material="<tier>"` 标记类 | 是 |
| 内联 `rgba(...)` 材质背景填充 | 禁止 |
| 内联 `backdrop-filter` 声明 | 禁止 |
| 在工具包生成的实用类之外手动选择 `backdrop-blur-*` Tailwind 命名令牌 | 禁止 |
| 强调包覆盖 `material.*` 或 `backdrop.*` 令牌 | 禁止（材质令牌是中立的基础层） |
| 添加第六个层级 | 需要新的准入（未预先授权） |

通过 `<Surface>` 原始组件消费材质的偏好确保了跨应用的一致性行为。

## 层级存在的原因

每个层级的存在都有其特定的阅读目的：

| 层级 | 用途 |
| --- | --- |
| `solid` | 高优先级表面，像素可读性最重要（表单、密集数据） |
| `glass-thin` | 微妙的悬停/覆盖表面，不应在视觉上脱离 |
| `glass-regular` | 标准玻璃表面（大多数覆盖层、侧边栏） |
| `glass-thick` | 较重的玻璃表面，用于需要主导背景运动的表面（动画上的模态框） |
| `glass-chrome` | 最强的玻璃处理，用于铬级别表面（顶部栏、命令面板） |

该分类是有意见的。作者不能自由混合背景模糊值以创建新的视觉效果。

## 性能降级钩子接口

玻璃层级会带来 GPU 成本。合同保留了一个性能降级钩子接口，运行时实现可以使用该接口在设备无法承受时降级为较低成本的层级。运行时实现降级行为是单独的消费者责任；合同固定了**接口**，以便应用可以一致地读取降级后的层级。

降级**不会**改变材质分类本身——它改变了渲染时解析的层级。一个被编写为 `glass-chrome` 的表面可能在降级设备上渲染为 `glass-regular`；编写合同保持不变。

## 可访问性对比阈值

合同固定了材质层级对已准入色调家族的 a11y 对比阈值。层级选择不能使文本/边界对比度低于已准入的阈值；需要非默认对比度的消费者必须使用已准入的例外机制——而不是发明一个平行的材质轴。

## 读者场景：模态框选择其层级

一个应用需要在动画背景内容上显示一个模态框。

1. **选择层级意图。** 模态框必须清晰可读，而背景可以动画。`glass-thick` 符合要求。
2. **使用原始组件。** `<Surface material="glass-thick">...</Surface>`。
3. **令牌解析。** 背景和边框从 `material.glass_thick.*` 解析；背景模糊从 `backdrop.blur_strong` 解析。
4. **性能降级。** 在低功耗设备上，运行时可能会降级为 `glass-regular`；模态框仍然可读。

作者只需写一个 `material="glass-thick"`，其余部分都是已准入的。

## 读者场景：模块尝试内联玻璃

一个模块作者为自定义面板编写内联 `style=\{\{ background: 'rgba(...)', backdropFilter: 'blur(20px)' \}\}`。

1. **拒绝。** 根据消费者规则，内联 `rgba(...)` 材质背景和内联 `backdrop-filter` 声明是禁止的。
2. **重新路由。** 模块使用 `<Surface material="glass-regular">` 或其他符合意图的已准入层级。
3. **视觉一致性。** 模块的面板与其他平台中的已准入玻璃表面匹配。

## 读者场景：想要第六个层级

一个设计师提出一个新的视觉上下文所需的第六个材质层级。

1. **封闭分类。** 合同未预先授权扩展。
2. **需要准入。** 提案需经过治理：将新层级添加到 `tables/nimi-ui-tokens.yaml` 材质类别中，准入新的模糊半径，将新层级添加到 `<Surface>` 原始组件的变体集中，审查性能降级接口。
3. **准入后。** 新层级以相同的消费者规则发布。

这种边界是故意设定的：自由形式的材质扩展会使设计系统变成每个应用的蔓延。

## 这些规则不包括的内容

- 它不允许强调包覆盖材质令牌。
- 它不允许内联玻璃。
- 它不允许应用在已准入的工具包实用类之外发明自定义模糊值。
- 它不允许未经准入就添加第六个层级。
- 它不会在性能降级下改变层级行为——只有解析的层级发生变化；编写合同是稳定的。

## 边界总结

| 关注点 | 权威 |
| --- | --- |
| 五级分类 + 令牌 | `P-DESIGN-022`（此合同） |
| 令牌目录 | `tables/nimi-ui-tokens.yaml` |
| 主题值 | `tables/nimi-ui-themes.yaml` |
| `<Surface>` 原始组件 | `@nimiplatform/kit/ui` |
| 性能降级接口 | 此合同（规范层面） |
| 运行时性能降级实现 | 消费者责任（单独） |

## 来源依据

- [`.nimi/spec/platform/kernel/nimi-ui-material-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/nimi-ui-material-contract.md)
- [`.nimi/spec/platform/kernel/design-pattern-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/design-pattern-contract.md)
- [`.nimi/spec/platform/kernel/tables/nimi-ui-tokens.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/nimi-ui-tokens.yaml)
- [`.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml)
- [`.nimi/spec/platform/kernel/kit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/kit-contract.md)
