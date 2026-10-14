# 生成动作与 Mapping Sidecar

Avatar 根据已验证的模型能力与内置路由生成后端渲染输出。当前生成动作目录中的路由目标为 VRM；Live2D 依赖自身的内置映射与模型能力事实，不通过这些 VRM sidecar 获得路由支持。

## 当前 VRM 路径

Runtime 下发已准入的活动等语义，Avatar 将其映射为目录中的对应路由（例如将 `agree` 映射到 `nod_yes`）。当前目录中的路由包括 `idle_subtle`、`listen_lean`、`nod_yes`、`shake_no` 和 `greet_wave`。这些均为 Avatar 后端内部标识，不是对外的 APML 标签，也不会引入新的 Runtime 活动。

VRM provider 结合模型、路由、动作强度与循环参数，生成对应的动画 clip，或在失败时返回带有 `reasonCode` 的 `fail_closed` 结果。当能力配置缺失、目标不受支持或姿态不安全时，系统会明确执行 fail-closed，绝不会用静态待机（idle）冒充成功；此外，支持这些路由并不要求本地存在物理 `.vrma` 文件。

## Sidecar 的准确字段

当前 VRM 解析器仅接受下列顶层字段，未知字段会被直接拒绝：

| 字段 | 用途 |
| --- | --- |
| `sidecar_id` | 非空映射标识 |
| `route_id` | 当前目录中已准入的 VRM 路由 ID |
| `backend_kind` | 当前解析器要求固定为 `vrm` |
| `profile_id` | 必须匹配用于评估支持度的能力配置文件 ID |
| `confidence` | 0 到 1 的置信度数值；执行准入判定时不得低于 `threshold` |
| `threshold` | 0.82 到 1 的阈值；可调高，但不能低于当前默认底线 |
| `manual_confirmation` | 可选值为 `unconfirmed`、`confirmed` 或 `rejected` |
| `source_kind` | 可选值为 `deterministic_manifest`、`static_name_match`、`llm_semantic_match` 或 `human_review` |
| `target_fields` | 非空目标列表；每项目标包含 `target_kind` 与 `name`，可选 `role` |

Sidecar schema 中不存在 `route` 或 `fallback` 字段。置信度仅用于准入判断，不用于多个候选条目之间的优先级排序；请为每个路由提供唯一明确的映射，不要依赖同名路由的条目书写顺序。

LLM 生成的映射必须具备 `confirmed` 状态；标记为 `rejected` 或低于置信度阈值的映射均不予支持。`target_kind` 的合法取值包括 `humanoid_bone`、`expression_preset`、`lookat`、`motion_group` 与 `parameter_id`；所有声明的目标还必须符合所选后端与能力 profile 中记录的事实。

## 结构样例

以下 YAML 片段可通过语法和结构解析。但在实际生效前，示例中的 `demo-vrm-profile` 与 `neck` 目标仍须与实际验证过的模型 profile 吻合，该路由才会被判定为受支持：

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

结构解析通过仅代表配置格式合法，不代表模型已成功执行动作。验证实际支持情况时，系统还会全面核验 profile、后端类型、声明路由、人工确认状态及具体目标事实。

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
