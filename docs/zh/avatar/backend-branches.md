# 后端分支

Avatar 的渲染后端是一个**封闭的判别联合**：`live2d | vrm`。Live2D 通过 Cubism SDK for Web 已在生产中使用；VRM 是规划中的后端分支。生成式动作以独立 Provider 的形态准入，仍走同一套后端分支模型。

## 封闭联合，不是开放插件

| 属性 | 值 |
| --- | --- |
| 后端 | `live2d`，`vrm`（未来） |
| 封闭性 | 新增后端必须经契约准入 |
| 判别联合 | 类型收窄后才暴露后端专属扩展 |
| Live2D 现状 | 通过 Cubism SDK for Web 提供 |
| VRM 现状 | 未来的后端分支，尚未提供 |

希望"插一个新后端就能跑"的读者会失望——后端清单由内核准入，不在作者层自由扩展。

## Live2D 后端

| 属性 | 值 |
| --- | --- |
| 技术 | Cubism SDK for Web |
| 状态 | 已在生产中使用 |
| 资产兼容 | 见 `live2d-asset-compatibility-contract.md` |
| 渲染契约 | 见 `live2d-render-contract.md` |
| 后端扩展 | Live2D 专属 API，例如 `live2dExtension` |

Live2D 是当前生产后端。今天的 Avatar 包通常都是 Live2D 包。

## VRM 后端

| 属性 | 值 |
| --- | --- |
| 技术 | VRM 3D 资产标准 |
| 状态 | 规划分支，尚未提供 |
| 后端扩展 | VRM 专属（上线后开放） |

VRM 提前准入是为了让 NAS 处理器今天就能写出可移植的代码，而不被 Live2D 的特性绑死——其中有些特性 VRM 无法照搬。后端分支模型正是为了避免在新后端上线时重写处理器。

## 生成式动作

`generated-motion-provider-contract.md` 描述了 AI 生成动作如何驱动具身化。它以 Provider 形态准入，归在同一套后端分支模型下。

| 属性 | 值 |
| --- | --- |
| 来源 | AI 动作生成 Provider |
| 输出 | 后端专属的动作调用 |
| Provider 生命周期 | 在该契约下准入与下线 |

"Agent 的动作有生命感"，靠的就不只是手工动画，而是这条 Provider 能力。

## Live2D 资产兼容

| 关注点 | 契约负责什么 |
| --- | --- |
| 资产版本兼容 | 准入哪些 Cubism 版本 |
| 必需参数 | 模型必须声明的参数 |
| 可选参数 | 提供更丰富渲染时所用的参数 |
| 失败模式 | 必需参数缺失时如何处理 |

缺少必需参数的 Live2D 模型在接受阶段就 fail-closed。可选参数存在时启用更细致的渲染。

## 场景：NAS 处理器保持可移植

某个 NAS 处理器要给一个空闲姿势写动画。

1. **使用宿主无关 API**。处理器调用语义层的 idle 姿势方法。
2. **今天在 Live2D 上**。语义层经 Live2D 扩展通道走，姿势由 Live2D 参数渲染。
3. **将来在 VRM 上**。VRM 上线后，同一份处理器经 VRM 扩展通道走，姿势由 VRM 能力渲染。
4. **同一份处理器，所有后端通用**。

宿主无关的处理器在不同后端之间天然可移植。

## 场景：Live2D 资产兼容性不匹配

用户安装一个针对旧版 Cubism 构建的 Live2D Avatar 包。

1. **资产兼容检查**。按 `live2d-asset-compatibility-contract.md` 进行。
2. **决定**。两种结果：
   - 视为兼容（处于准入版本范围内）；或
   - 以强类型原因拒绝（超出准入范围）。
3. **强类型结果**。用户看到明确结论；平台不会悄悄渲染一个不被支持的包。

兼容性是契约决定的，不是启发式判断。

## 后端分支不做的事

| 关注点 | 不做的原因 |
| --- | --- |
| 允许自由格式后端 | 设计上就是封闭联合 |
| 允许绕过契约的运行期后端选择 | 判别联合强制走强类型选型 |
| 允许未经准入的跨后端资产复用 | 每个后端的兼容性各自准入 |

## Source Basis

- [`.nimi/spec/avatar/kernel/backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/backend-branch-contract.md)
- [`.nimi/spec/avatar/kernel/live2d-render-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/live2d-render-contract.md)
- [`.nimi/spec/avatar/kernel/live2d-asset-compatibility-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/live2d-asset-compatibility-contract.md)
- [`.nimi/spec/avatar/kernel/vrm-backend-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/vrm-backend-contract.md)
- [`.nimi/spec/avatar/kernel/generated-motion-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/generated-motion-provider-contract.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
