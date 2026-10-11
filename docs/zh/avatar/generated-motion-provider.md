# 生成动作与 Mapping Sidecar

Avatar 根据已验证的模型能力与内置路由生成后端输出。当前生成动作目录中的路由目标为 VRM；Live2D 使用自己的内置映射与模型能力，不通过这些 VRM sidecar 获得路由支持。

## 当前 VRM 路径

Runtime 提供已准入的活动等语义，Avatar 将其映射为目录中的路由，例如 agree 对应 nod_yes。当前目录包括 idle_subtle、listen_lean、nod_yes、shake_no 和 greet_wave。路由是 Avatar 后端标识，不是公共 APML 标签，也不新增 Runtime 活动。

VRM provider 根据模型、route、强度与循环参数返回生成的 clip，或返回带 reasonCode 的 fail_closed 结果。缺少能力配置、目标不支持或姿态不安全时，不用静态待机冒充请求成功，也不要求存在 .vrma 文件才支持这些路由。

## Sidecar 的准确字段

当前 VRM parser 只接受下列顶层字段，未知字段会被拒绝：

| 字段 | 用途 |
| --- | --- |
| `sidecar_id` | 非空映射标识 |
| `route_id` | 当前目录中已准入的 VRM route ID |
| `backend_kind` | 当前 parser 要求为 vrm |
| `profile_id` | 必须匹配用于评估支持的能力配置 |
| `confidence` | 0到1的置信度，执行准入时不得低于 threshold |
| `threshold` | 0.82到1的阈值，可提高但不能低于当前默认底线 |
| `manual_confirmation` | unconfirmed、confirmed 或 rejected |
| `source_kind` | deterministic_manifest、static_name_match、llm_semantic_match 或 human_review |
| `target_fields` | 非空目标列表，每项含 target_kind、name，可选 role |

没有 route 或 fallback 字段。置信度用于准入，不用于候选排序；不要依赖重复同 route 映射的顺序，给一个 route 提供一个确定的有效映射。

LLM 来源的映射需要 confirmed；rejected 或低于阈值的映射不受支持。target_kind 取 humanoid_bone、expression_preset、lookat、motion_group 或 parameter_id，具体目标还必须符合所选后端与 profile 的事实。

## 结构样例

以下 YAML 可通过结构解析，但 demo-vrm-profile 和 neck 仍须与实际已验证的 profile 匹配，才能证明支持该路由：

```yaml
sidecar_id: demo-nod
route_id: nod_yes
backend_kind: vrm
profile_id: demo-vrm-profile
confidence: 0.95
threshold: 0.9
manual_confirmation: confirmed
source_kind: human_review
target_fields:
  - target_kind: humanoid_bone
    name: neck
```

结构解析通过不等于模型已执行动作。验证实际支持时，还需匹配 profile、后端、路由声明、确认状态与目标事实。

## 相关文档

- [模型能力配置](/zh/avatar/model-capabilities)
- [VRMA 交换动画](/zh/avatar/vrm-motion-authoring)

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`config/avatar-generated-motion-routes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-generated-motion-routes.yaml)
- [`config/avatar-backend-capability-profile.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-backend-capability-profile.schema.yaml)
- [`config/avatar-mapping-sidecar.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-mapping-sidecar.schema.yaml)
- [`apps/avatar/src/shell/renderer/vrm/vrm-mapping-sidecar.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-mapping-sidecar.ts)
- [`apps/avatar/src/shell/renderer/vrm/vrm-generated-motion-contract.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-generated-motion-contract.ts)
