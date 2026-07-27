# Live2D 集成

Live2D 是 Avatar 已准入的渲染后端之一。它使用官方 Cubism SDK for Web，但 Avatar 不会只凭 Cubism 文件推断一个包能做什么。Avatar 会验证包、计算已证明的兼容层级，然后把模型接入统一的具身化表面。

这一页也说明 Live2D adapter manifest 的编写方式。adapter 是包作者描述模型能力的文件，用来说明一个现有 Cubism 模型如何映射到 Avatar 的活动、表情、口型同步、物理、姿态和点击区域行为，而不要求改写原始模型文件。

## SDK 边界

| 关注点 | 实现 |
| --- | --- |
| SDK | Cubism SDK for Web |
| 渲染器 | `apps/avatar` 拥有的 WebGL 画布 |
| 模型入口 | `model3.json`，以及它声明的动作、表情、物理、姿态、纹理和点击区域 |
| 逐帧更新 | Cubism `model.update()` 加 Avatar 后端调度 |
| 音频桥接 | `wLipSync` 驱动 `ParamMouthOpenY`，并按能力使用可选嘴形参数 |
| 包语义 | adapter manifest 加兼容性验证 |

Live2D 后端在 Avatar 的封闭后端联合里是 `kind: 'live2d'`。Carrier 代码和 NAS 处理器通过后端接口消费它，不直接访问 Cubism 内部。

## 模型加载

Avatar 加载 Live2D 包时会经过四步：

1. 通过 Avatar 包解析器解析已选择的本地 Avatar 资源。
2. 加载选中的 `model3.json` 以及它声明的所有资源。
3. 验证兼容性、adapter 声明、许可姿态和包证据。
4. 报告模型边界和后端名义边界，让透明桌面外壳能按可见身体调整窗口大小。

验证失败的包不会被当作成功的 Avatar 载体。缺少必需行为会关闭该路径；缺少可选行为会降低兼容层级，或记录明确的不支持状态。

## 兼容层级

| 层级 | 含义 |
| --- | --- |
| `unsupported` | 必需 schema、许可、模型或功能声明验证失败。 |
| `render_only` | Cubism 模型可以渲染，但不承诺活动、表情、姿态、口型同步或点击区域行为。 |
| `semantic_basic` | 必需伴侣活动已映射，可选能力有明确处置。 |
| `companion_complete` | 包证明了当前 Avatar 载体需要的完整伴侣行为。 |

包可以请求某个层级，但 Avatar 只返回包和 adapter 实际证明的最高层级。

## Adapter Manifest 编写

创作者维护的 Live2D 包可以内嵌 adapter：

```text
<model-package>/runtime/nimi/live2d-adapter.json
```

Desktop 也可以为已有包选择外部 sidecar adapter。一次启动只使用一个 adapter 来源：内嵌 adapter 或已选择的 sidecar。Avatar 不合并 adapter，也不会静默偏向其中一个。

每个 adapter 都用这个身份开头：

```json
{
  "manifest_kind": "nimi.avatar.live2d.adapter",
  "schema_version": 1
}
```

主要字段如下：

| 字段 | 用途 |
| --- | --- |
| `adapter_id` | adapter 文件的稳定标识。 |
| `target_model` | 目标模型 id 和 `model3.json` 入口。 |
| `license` | 包的再分发和夹具使用姿态。 |
| `compatibility.requested_tier` | 作者希望 Avatar 评估的层级。 |
| `semantics.motions` | idle 和伴侣活动对应的动作组。 |
| `semantics.expressions` | Avatar 表情名到 Cubism 表情 id 的映射。 |
| `semantics.poses` | 姿态支持，或明确的不适用原因。 |
| `semantics.lipsync` | 口型同步使用的嘴部开合参数。 |
| `semantics.physics` | 模型物理是否可用。 |
| `semantics.hit_regions` | 点击区域别名和可选 alpha 蒙版备选。 |

功能声明必须明确。如果模型不支持某项能力，就标记为 `unsupported` 或 `not_applicable`，并写明原因。把空白留给加载器猜测通常会降低最终层级。

## 最小 Adapter 形状

```json
{
  "manifest_kind": "nimi.avatar.live2d.adapter",
  "schema_version": 1,
  "adapter_id": "ren-live2d-adapter",
  "target_model": {
    "model_id": "ren",
    "model3": "ren.model3.json"
  },
  "license": {
    "redistribution": "allowed",
    "evidence": "Model owner reviewed redistribution rights.",
    "fixture_use": "committable"
  },
  "compatibility": {
    "requested_tier": "semantic_basic"
  },
  "semantics": {
    "motions": {
      "idle": { "group": "Idle" },
      "activities": {
        "neutral": { "group": "RenNeutral" },
        "greet": { "group": "RenGreet" },
        "listening": { "group": "RenListening" },
        "thinking": { "group": "RenThinking" }
      },
      "missing_activity": "diagnostic_no_success"
    },
    "expressions": {
      "map": { "happy": "smile" },
      "disposition": { "status": "supported" }
    },
    "poses": {
      "map": {},
      "disposition": {
        "status": "not_applicable",
        "reason": "Model has no pose3 file."
      }
    },
    "lipsync": {
      "mouth_open_y_parameter": "ParamMouthOpenY",
      "disposition": { "status": "supported" }
    },
    "physics": {
      "mode": "model_physics",
      "disposition": { "status": "supported" }
    },
    "hit_regions": {
      "map": {
        "head": ["head"],
        "body": ["body"]
      },
      "fallback": "alpha_mask_only",
      "disposition": { "status": "supported" }
    }
  }
}
```

## 编写检查表

- 包里只有一个被选中的 `*.model3.json`。
- `target_model.model_id` 与解析出的模型 id 一致。
- `FileReferences.Moc` 和所有声明的纹理都存在。
- idle 动作组存在。
- 请求 `semantic_basic` 时，`neutral`、`greet`、`listening`、`thinking` 都映射到已有动作组。
- adapter 里的每个表情 id 都存在于 `FileReferences.Expressions`。
- 只有包里存在姿态文件时，才声明姿态支持。
- 口型同步指向可用嘴部开合参数，例如 `ParamMouthOpenY`。
- 只有模型物理文件存在并能加载时，才声明物理支持。
- 点击区域别名指向模型声明的 hit area，或声明 alpha 蒙版备选。
- 在共享、提交或分发包与 adapter 之前，先确认许可证据。

## 诊断

adapter 诊断是强类型的。常见例子包括：

| 代码 | 常见含义 |
| --- | --- |
| `AVATAR_LIVE2D_COMPAT_MANIFEST_INVALID` | adapter JSON 不符合 schema。 |
| `AVATAR_LIVE2D_COMPAT_MODEL_ID_MISMATCH` | adapter 指向了另一个模型。 |
| `AVATAR_LIVE2D_COMPAT_LICENSE_UNVERIFIED` | 许可姿态缺失或证据不足。 |
| `AVATAR_LIVE2D_COMPAT_MOTION_MISSING` | 声明的动作组不存在。 |
| `AVATAR_LIVE2D_COMPAT_EXPRESSION_MISSING` | 声明的表情 id 不存在。 |
| `AVATAR_LIVE2D_COMPAT_LIPSYNC_PARAMETER_MISSING` | 嘴部参数不可用。 |
| `AVATAR_LIVE2D_COMPAT_HIT_REGION_MISSING` | 声明的点击区域无法解析。 |

诊断不是部分成功。它告诉作者哪条声明需要修正、降低层级，或标记为不支持。

## NAS 参数访问

后端中立的参数访问走 NAS context。Live2D 参数直接写入需要先做类型收窄，再使用 `Live2DBackendExtension`：

```js
export default {
  requires: ['live2d-extension'],
  async run(ctx) {
    if (ctx.backend.kind !== 'live2d') return;
    ctx.live2dExtension.setParameter('ParamMouthForm', 0.7);
  }
};
```

直接写入适合后端专属效果。可移植处理器应优先使用宿主无关的 NAS 表面。

## 场景：包以正确层级加载

作者导入一个 Live2D 包，并附上请求 `companion_complete` 的 adapter。

1. Avatar 验证包和 adapter。
2. 模型可以渲染，但 adapter 声明了一个实际不存在的姿态文件。
3. Avatar 报告缺失姿态的诊断，并返回已证明的最高层级。
4. 如果剩余必需行为有效，该包仍可按较低的已证明层级加载。

产品表面展示的是包实际支持的能力。它不会把不支持的行为静默升级成成功。

## 来源依据

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`config/avatar-live2d-compatibility-tiers.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-live2d-compatibility-tiers.yaml)
- [`config/avatar-live2d-adapter-manifest.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-live2d-adapter-manifest.schema.yaml)
- [`config/avatar-live2d-adapter-diagnostics.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-live2d-adapter-diagnostics.yaml)
