# Live2D 集成

> 状态：运行中 (Running)。Live2D 是已交付的后端分支；Cubism SDK for Web 是官方集成路径。

Live2D 是 Avatar 的活跃渲染后端。集成通过官方的 Cubism SDK for Web 进行，其参数、动作、表情和物理表面通过宿主无关的映射层暴露，并提供一个 `Live2DBackendExtension` 逃生舱口，用于参数 ID 的直接写入。

## SDK 边界

| 关注点 | 实现 |
| --- | --- |
| SDK | Cubism SDK for Web (官方) |
| 渲染器 | 由 `apps/avatar` 拥有的 WebGL 画布 |
| 模型加载 | `model3.json` + 动作 / 表情 / 物理 / 姿态 / 纹理资产 |
| 逐帧更新 | 由 NAS 连续调度器驱动的 `model.update()` |
| 音频桥接 | `wLipSync` 流水线写入 `ParamMouthOpenY`（+ 根据资产层级可选的 `ParamMouthForm`） |
| 默认行为 | Cubism 呼吸 / 眨眼 / 口型同步；NAS 处理器可根据契约进行覆盖 |

Live2D 分支在封闭的 `BackendKind` 联合类型中为 `kind: 'live2d'`。它实现了 `BackendBranch` 接口；载体和映射层通过该接口消费它，而不是直接访问 Cubism 内部。

## 模型加载

Avatar 应用通过以下步骤加载 Live2D 模型包：

1.  通过已准入的解析器解析包描述符。
2.  加载 `model3.json` 及其声明的资产（动作、表情、物理、姿态、纹理、点击区域）。
3.  对照 `live2d-asset-compatibility-contract.md` 运行兼容性验证，并计算资产层级。
4.  向映射层报告 `embodiment_bounds`（模型 alpha 边界框）和 `BackendNominalBounds`，以便外壳可以调整窗口大小。

未能通过兼容性验证的模型不会成功加载。缺少必需参数会导致加载失败；缺少可选参数会降低资产层级。

## 资产兼容性层级

| 层级 | 含义 | 产品声明 |
| --- | --- | --- |
| `unsupported` | 布局 / 许可 / 模式 / 声明功能检查失败 | 不得成功加载 |
| `render_only` | Cubism 渲染模型；不承诺语义活动 / 表情 / 姿态 / 口型同步支持 | “仅作为 Live2D 模型渲染” |
| `semantic_basic` | 必需的基本伴侣语义已映射；可选功能已明确处置 | “作为基本伴侣工作，具有有限的降级功能” |
| `companion_complete` | 完整的当前活动集 + 表情 / 姿态 / 口型同步 / 点击区域 + 可选物理效果 | “为活跃的 Avatar 载体提供完整的当前 Live2D 伴侣行为” |

层级要求位于 `.nimi/spec/avatar/kernel/tables/live2d-compatibility-tiers.yaml`。

## 参数 API

后端中立的参数访问通过映射 API (`ctx.params`) 进行。直接参数 ID 写入——这是每个 Live2D 作者最终都希望实现的方式——通过 `Live2DBackendExtension` 进行：

```js
export default {
  requires: ['live2d-extension'],
  async run(ctx) {
    if (ctx.backend.kind !== 'live2d') return;
    ctx.live2dExtension.setParameter('ParamMouthForm', 0.7);
  }
};
```

直接写入是显式的、类型收窄的，并与声明依赖的包绑定。

## 口型同步流水线 (wLipSync)

| 阶段 | 所有者 | 接口 |
| --- | --- | --- |
| 语音生成 | 运行时 | `runtime.agent.voice.*` 事件 |
| 音频字节 | 运行时 | `runtime.artifacts.readBytes` |
| `wLipSync` 分析 | Avatar (Live2D 分支) | `audio-pipeline.ts` |
| 帧批次 | Avatar | `lipsync_frame_batch` |
| 参数写入 | Live2D 后端 | `ParamMouthOpenY`（+ 根据层级可选的 `ParamMouthForm`） |

口型同步是平台中最跨领域的协同路径。它跨越运行时 → SDK 队列 → Avatar 映射 → Live2D 参数写入，所有这些都通过已准入的衔接点进行。

## NAS 连续调度

NAS 连续处理器（例如 `breathe.js`、`eye_tracker.js`）根据 Live2D `model.update()` 的调度运行。默认的 Cubism 行为（呼吸、眨眼、口型同步）与 NAS 覆盖项根据渲染契约中的覆盖边界进行组合——覆盖项不会静默地终止默认行为；它们会根据声明的范围替换默认行为。

## 读者场景：Live2D 包以正确的层级加载

1.  **作者打包。** 他们的 `model3.json` 以及动作、表情、物理、姿态、点击区域。他们发布一个声明 `companion_complete` 的清单。
2.  **Avatar 验证。** 验证器计算实际证明的最高层级。如果缺少必需的姿态，清单的声明将被降级。
3.  **结果。** 验证器返回 `semantic_basic`，并附带明确的诊断代码，指明缺少的姿态。包以已证明的层级加载；产品声明随之调整。

验证器不会静默地修复清单。它报告包实际支持的真实情况。

## 读者场景：处理器驱动 Live2D 特定效果

1.  **作者处理器。** `mychar/runtime/nimi/event/onSurprise.js`。作者希望直接驱动 `ParamMouthForm` 以实现风格化的反应。
2.  **声明要求。** `requires: ['live2d-extension']`。
3.  **类型收窄。** `if (ctx.backend.kind !== 'live2d') return;`
4.  **直接写入。** `ctx.live2dExtension.setParameter(...)`。
5.  **行为。** 在 Live2D 上，参数化效果会播放。在未来将同一模型角色挂载到 VRM 时，由于要求未满足，该处理器将被跳过——没有静默回退，也没有崩溃。

该逃生舱口是已准入的。其规范在于类型收窄。

## Live2D 集成不做什么

-   它不重新定义活动 / 情感 / 姿态的真实性——那是运行时负责的。
-   它不拥有具身映射语义——那是 `embodiment-projection-contract.md` 负责的。
-   它不会静默地替换声明的默认 Cubism 行为——覆盖是根据渲染契约按范围进行的。
-   桌面聊天应用的独立 Live2D 渲染器不能作为 Avatar 载体接受的证明——参见 [视觉验收](/avatar/visual-acceptance.md)。

## 来源依据

- [`.nimi/spec/avatar/kernel/live2d-render-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/live2d-render-contract.md)
- [`.nimi/spec/avatar/kernel/live2d-asset-compatibility-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/live2d-asset-compatibility-contract.md)
- [`.nimi/spec/avatar/kernel/tables/live2d-compatibility-tiers.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/tables/live2d-compatibility-tiers.yaml)
- [`.nimi/spec/avatar/kernel/tables/live2d-adapter-manifest.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/tables/live2d-adapter-manifest.schema.yaml)
- [`.nimi/spec/avatar/kernel/tables/live2d-adapter-diagnostics.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/tables/live2d-adapter-diagnostics.yaml)
- [`.nimi/spec/avatar/kernel/backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/backend-branch-contract.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)