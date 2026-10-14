# Live2D 渲染集成

Live2D 是 Avatar 支持的核心图形渲染后端之一。它依托官方 Cubism SDK for Web 构建，但 Avatar 并不会单凭散落的 Cubism 模型文件主观推断其支持的行为特性。Avatar 会全面校验资源包结构、计算形式化验证后证明的**实际兼容层级**，并将模型平滑接入统一的跨端具身化表面。

本文档同时涵盖 Live2D Adapter Manifest 适配清单的编写指引。通过 Adapter 清单文件，创作者可以清晰描述一个现成的 Cubism 模型如何与 Avatar 的活动、表情、口型同步、物理仿真、姿态以及点击区域建立映射，而完全无需改动原始的 Live2D 模型工程。

## SDK 与渲染器边界

| 关注维度 | 实现技术与组件 |
| --- | --- |
| 底层 SDK 内核 | 官方 Cubism SDK for Web |
| 前端画布渲染器 | `apps/avatar` 统筹管理的 WebGL Canvas 上下文 |
| 模型入口描述 | `model3.json`，及其声明的动作、表情、物理仿真配置、纹理集与碰撞区 |
| 逐帧逻辑更新 | Cubism `model.update()` 结合 Avatar 后端时钟调度 |
| 音频口型驱动 | `wLipSync` 算法驱动 `ParamMouthOpenY`，配合可选嘴型参数计算 |
| 模型包元数据 | 经由 Adapter Manifest 校验的兼容性评级 |

在 Avatar 的封闭渲染引擎枚举中，Live2D 分支标识符为 `kind: 'live2d'`。Avatar 内部的宿主载体适配层只面向中立具身接口工作，创作者脚本不会直接接触 Cubism 内部类或 Live2D 的底层参数扩展。

## 模型资产加载流程

Avatar 加载一个 Live2D 资产包经过以下四个确定性步骤：

1. **安全解析**：通过 Avatar 资产解析器定位并校验本地资源路径。
2. **完整加载**：加载指定的 `model3.json` 及其声明的 Moc 核心数据、贴图与动作文件。
3. **兼容性验真**：严格核对 Adapter 适配声明、版权许可凭据与实际包含的文件证据。
4. **窗口边界测算**：向桌面宿主上报模型的名义物理边界与网格包围盒，以便桌面透明悬浮窗根据角色身材自适应贴合调整尺寸。

校验未通过的包绝不会被当作正常就绪的模型加载。若缺失必要的核心文件将直接阻断退出；若仅缺失可选的装饰性表情，系统会自动平滑降低兼容层级，并向开发者返回结构化排错信息。

## 兼容性层级定义 (Compatibility Tiers)

| 兼容层级 | 评级含义与系统支持策略 |
| --- | --- |
| `unsupported` | 校验失败：缺少核心 Schema、版权许可不合规或关键文件损坏 |
| `render_only` | 仅支持基础渲染：角色可正常绘制，但不提供动态表情、手势动作、口型或点击交互保证 |
| `semantic_basic` | 达到伴随基线：已完整映射核心伴随活动（日常待机、聆听、思考、问候），可选能力处置清晰 |
| `companion_complete` | 完整伴随体验：经过充分验证，完整支持当前 Avatar 桌面端的所有高级交互特性 |

创作者可在配置文件中声明所期望的层级，但 Avatar 仅以实测验证证据证明的最高层级为准。

## Adapter Manifest 编写规范

创作者维护的 Live2D 模型包推荐直接内嵌 Adapter 配置文件：

```text
<model-package>/runtime/nimi/live2d-adapter.json
```

若针对已有模型补充适配，亦可在 Desktop 侧配置外部 Sidecar 适配文件。启动时系统遵循单一来源原则，绝不会将多个配置文件隐式拼接混杂。

Adapter 配置文件头部固定声明：

```json
{
  "manifest_kind": "nimi.avatar.live2d.adapter",
  "schema_version": 1
}
```

### 核心属性字段速查

| 字段名称 | 用途与配置约定 |
| --- | --- |
| `adapter_id` | 适配器文件的唯一标识符 |
| `target_model` | 目标模型 ID 及 `model3.json` 的相对入口文件 |
| `license` | 声明模型的再分发与测试使用版权许可信息 |
| `compatibility.requested_tier` | 创作者期望申请评估的兼容层级 |
| `semantics.motions` | 映射通用活动（idle, greet, thinking 等）至模型对应的 Motion 组 |
| `semantics.expressions` | 将标准 Avatar 表情名映射至模型的表情文件 ID |
| `semantics.lipsync` | 指定用于音频口型同步的嘴部开合参数名称 |
| `semantics.physics` | 声明模型的物理摆动仿真配置 |
| `semantics.hit_regions` | 映射交互点击区域别名（如 head, body）至模型内部碰撞盒 |

所有功能声明应当明确客观：若当前模型未制作特定动作，应显式标记为 `unsupported` 或 `not_applicable` 并注明原因，切勿留白让加载器盲目猜测。

## 最小可用 Adapter 示例

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

## 编写与验收检查清单

- [ ] 模型根目录下包含唯一指定的 `*.model3.json` 主入口。
- [ ] `target_model.model_id` 与解析出的模型 ID 精确一致。
- [ ] `FileReferences.Moc` 核心网格与所有引用的纹理贴图文件完整无缺失。
- [ ] 必须包含可正常循环播放的 `idle` 待机动作组。
- [ ] 若申请 `semantic_basic` 层级，必须将 `neutral`、`greet`、`listening`、`thinking` 映射至有效动作组。
- [ ] 映射的所有表情 ID 必须在 `FileReferences.Expressions` 中明确声明。
- [ ] 口型同步参数准确指向可用的开合通道（如 `ParamMouthOpenY`）。
- [ ] 碰撞区域别名准确指向模型声明的 Hit Area，或配置 Alpha 遮罩兜底。
- [ ] 提交或分发前，已认真核对版权与分发许可证明。

## 强类型排错诊断码速查

| 诊断错误码 | 常见原因与排查方案 |
| --- | --- |
| `AVATAR_LIVE2D_COMPAT_MANIFEST_INVALID` | Adapter JSON 语法错误或未通过 Schema 模式校验 |
| `AVATAR_LIVE2D_COMPAT_MODEL_ID_MISMATCH` | Adapter 中指定的模型 ID 与实际加载的模型不一致 |
| `AVATAR_LIVE2D_COMPAT_LICENSE_UNVERIFIED` | 缺少版权许可字段或合规证据声明不足 |
| `AVATAR_LIVE2D_COMPAT_MOTION_MISSING` | 配置声明的动作组在模型文件中实际不存在 |
| `AVATAR_LIVE2D_COMPAT_EXPRESSION_MISSING` | 配置声明的表情 ID 在表情列表中缺失 |
| `AVATAR_LIVE2D_COMPAT_POSE_UNAVAILABLE` | 声明了姿态映射，但 FileReferences.Pose 缺失或不可用 |
| `AVATAR_LIVE2D_COMPAT_LIPSYNC_PARAMETER_MISSING` | 指定的嘴部开合参数在模型中未被定义 |
| `AVATAR_LIVE2D_COMPAT_HIT_REGION_MISSING` | 映射的点击碰撞区域名称无法在模型中找到 |

诊断日志明确告知创作者哪项声明需要修正，系统绝不会将故障隐瞒为虚假的成功。

## 典型场景：资源校验诊断与修复

创作者引入了一个新的 Live2D 资产包并声明了姿态支持：

1. **执行静态与动态验真**：Avatar 按照所申请层级解析模型及其适配文件。
2. **捕获资源缺失**：适配文件中声明了姿态映射，但 `FileReferences.Pose` 实际上缺失或不可用。
3. **输出类型化诊断**：系统输出结构化诊断码 `AVATAR_LIVE2D_COMPAT_POSE_UNAVAILABLE`，并将该层级判定为不支持，拒绝伪成功。
4. **针对性修复**：创作者根据诊断修正适配声明（移除未包含的姿态配置）或补充缺失的姿态资源后重新提交验证。

平台如实反映模型包经过验证的技术水准，既保障了展示的健壮性，也确保了规范的严肃性。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`config/avatar-live2d-compatibility-tiers.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-live2d-compatibility-tiers.yaml)
- [`config/avatar-live2d-adapter-manifest.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-live2d-adapter-manifest.schema.yaml)
- [`config/avatar-live2d-adapter-diagnostics.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-live2d-adapter-diagnostics.yaml)
