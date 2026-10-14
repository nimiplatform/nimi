# 模型能力与映射配置

模型包必须准确声明所选 Live2D 或 VRM 后端的实际能力。Avatar 在执行动作路由前会严格校验这些事实；单纯存在相关文件、拥有置信度数值，或模型包内带有创作者编写的 JavaScript，都不能单独作为支持某项行为的凭据。

## 能力配置

能力配置需遵循后端能力 schema：

- `profile_id`、`backend_kind` 和 `model_fingerprint` 唯一标识配置方案与目标模型。
- `generated_motion` 分别明确声明支持与不支持的路由，以及对应的安全限制。
- VRM 配置记录人形骨骼、表情预设、视线与姿态限制。
- Live2D 配置记录动作组、表情 ID 和参数 ID。

请仅声明模型实际具备的能力。一旦配置缺失、字段不匹配或动作目标不受支持，路由执行就会被阻断。

## Mapping Sidecar

当前生成动作目录中的路由目标均为 VRM，其 sidecar parser 要求 `backend_kind=vrm`。Live2D 依靠自身动作组、表情与参数事实完成内置映射，不从这些 VRM sidecar 获得路由支持。

Sidecar 负责将已准入的 Avatar 动作路由关联到已验证的模型目标。字段包含 `route_id`、匹配的 `profile_id`、置信度与阈值、数据来源、确认状态及目标列表，不包含关键帧数据或兜底（fallback）路由。准确字段与结构示例见[生成动作提供器](/zh/avatar/generated-motion-provider)。

由 LLM 生成的名称映射必须经过人工确认后方可准入。置信度需达到配置阈值，且仅用于门槛校验，不用于多候选结果的排序。

## 检查模型变更

1. 确认模型指纹与后端类型与能力配置保持一致。
2. 对照当前路由目录与模型实际能力，逐项复核支持声明。
3. 依据严格 schema 和对应 profile 校验 sidecar。
4. 在真实 Avatar 呈现链路中验证变更后的行为；若不受支持，需检查返回的失败原因。

本地诊断工具仅用于检查所选模型；若只有测试夹具（fixture）输出，并不能证明实时产品环境已经就绪。详见[后端诊断](/zh/avatar/debug-workbench)与[视觉呈现验收](/zh/avatar/visual-acceptance)。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`config/avatar-backend-capability-profile.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-backend-capability-profile.schema.yaml)
- [`config/avatar-mapping-sidecar.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-mapping-sidecar.schema.yaml)
- [`config/avatar-generated-motion-routes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-generated-motion-routes.yaml)
