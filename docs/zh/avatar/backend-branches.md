# 后端分支

Avatar 的渲染后端是**封闭判别 union**：`live2d | vrm`。Live2D 今天经 Cubism SDK for Web 提供；VRM 是未来后端分支。生成动作作为同一后端分支模型下的独立 Provider 关注被准入。

## 封闭 union，不是开放插件系统

| 性质 | 值 |
| --- | --- |
| 后端 | `live2d`、`vrm`（未来） |
| 封闭 | 新后端要准入合同 |
| 判别 union | 类型窄化暴露后端特定扩展 |
| Live2D 今天 | 经 Cubism SDK for Web 提供 |
| VRM 未来 | 未来后端分支；尚未提供 |

希望「随便接个新后端」的读者**做不到**。后端列表是被准入的；新后端在 kernel 层准入，不靠作者约定。

## Live2D 后端

| 性质 | 值 |
| --- | --- |
| 技术 | Cubism SDK for Web |
| 状态 | 今天可用 |
| 资产兼容 | 按 `live2d-asset-compatibility-contract.md` |
| 渲染合同 | 按 `live2d-render-contract.md` |
| 后端扩展 | Live2D 特定 API（比如 `live2dExtension`） |

Live2D 是生产后端。今天的形体化包通常是 Live2D 包。

## VRM 后端

| 性质 | 值 |
| --- | --- |
| 技术 | VRM 3D 资产标准 |
| 状态 | 未来分支（尚未提供） |
| 后端扩展 | VRM 特定（上线时） |

VRM 作为未来后端被准入，是为了让 NAS 处理器今天就能写可移植代码，不耦合 VRM 满足不了的 Live2D 特性。后端分支模型存在的目的就是让未来后端不要求重写处理器。

## 生成动作

`generated-motion-provider-contract.md` 描述 AI 生成动作怎么驱动形体化。它在同一后端分支模型下准入成 Provider。

| 性质 | 值 |
| --- | --- |
| 来源 | AI 动作生成 Provider |
| 输出 | 后端特定动作调用 |
| Provider 生命周期 | 在合同下准入 |

这就是让「Agent 的动作是活的」超过手写动画的原因。生成动作是被准入到 Avatar 的 Provider 能力。

## Live2D 资产兼容

| 关注 | 合同处理什么 |
| --- | --- |
| 资产版本兼容 | 哪些 Cubism 版本被准入 |
| 必填参数 | 形体化必须声明的参数 |
| 可选参数 | 让渲染更丰富的参数 |
| 失败模式 | 必填参数缺失时怎么办 |

缺必填参数的 Live2D 模型在接受度处 fail-close。可选参数存在时让渲染更丰富。

## 阅读场景：NAS 处理器保持可移植

某 NAS 处理器为 idle 姿势做动画。

1. **用后端无关 API。** 处理器调形体化呈现的 idle 姿势方法。
2. **今天 Live2D。** 呈现层经 Live2D 扩展路由；idle 姿势用 Live2D 参数渲染。
3. **明天 VRM。** VRM 上线时，同一处理器经 VRM 扩展路由；idle 姿势用 VRM 能力渲染。
4. **同一处理器到处发。**

后端无关处理器在跨后端时是可移植的。

## 阅读场景：Live2D 资产兼容不匹配

某用户装了一个为旧 Cubism 版本造的 Live2D 形体化包。

1. **资产兼容检查。** 按 `live2d-asset-compatibility-contract.md`。
2. **决定。** 要么：
   - 准入为兼容（在准入版本范围内），要么
   - 拒绝带类型化原因（超出准入范围）。
3. **类型化结果。** 用户看到决定；平台**不**静默渲染不支持的包。

兼容性是合同，不是启发式。

## 后端分支**不**做什么

| 关注 | 为什么不 |
| --- | --- |
| 允许自由后端 | 设计上是封闭 union |
| 允许绕过合同的运行时后端选择 | 判别 union 强制类型化选择 |
| 允许跨后端资产复用而不准入 | 每个后端的兼容性要被准入 |

## 来源

- [`.nimi/spec/avatar/kernel/backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/backend-branch-contract.md)
- [`.nimi/spec/avatar/kernel/live2d-render-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/live2d-render-contract.md)
- [`.nimi/spec/avatar/kernel/live2d-asset-compatibility-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/live2d-asset-compatibility-contract.md)
- [`.nimi/spec/avatar/kernel/vrm-backend-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/vrm-backend-contract.md)
- [`.nimi/spec/avatar/kernel/generated-motion-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/generated-motion-provider-contract.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
