# 模型能力与映射配置

模型包需要描述所选 Live2D 或 VRM 后端的真实能力。Avatar 在执行路由前校验这些事实；文件存在、置信度数值或创作者的 JavaScript 都不能单独证明支持某项行为。

## 能力配置

按后端能力 schema 提供配置：

- `profile_id`、`backend_kind` 和 `model_fingerprint` 标识配置与模型。
- `generated_motion` 分别声明支持和不支持的路由，以及安全限制。
- VRM 配置记录人形骨骼、表情预设、视线与姿态限制。
- Live2D 配置记录动作组、表情 ID 和参数 ID。

只声明模型实际具备的能力。配置缺失、不匹配或目标不受支持时，执行会被阻断。

## Mapping Sidecar

当前生成动作目录中的路由目标为 VRM，其 sidecar parser 要求 backend_kind=vrm。Live2D 按自身动作组、表情与参数事实完成内置映射，不从这些 VRM sidecar 获得路由支持。

Sidecar 将一个已准入的 Avatar 路由关联到已验证的模型目标。字段包括 `route_id`、匹配的 `profile_id`、置信度与阈值、来源、确认状态和目标列表，不包含关键帧或 fallback 路由。准确字段与结构样例见[生成动作提供器](/zh/avatar/generated-motion-provider)。

LLM 产生的名称映射必须经过人工确认才能准入。置信度需要达到配置阈值，不用于多候选排序。

## 检查模型变更

1. 确认模型指纹和后端类型与能力配置一致。
2. 对照当前路由目录与模型事实，检查每一项支持声明。
3. 按严格 schema 和对应 profile 校验 sidecar。
4. 在真实 Avatar 呈现路径中验证改变的行为；不支持时检查返回的失败原因。

本地诊断用于检查所选模型；只有夹具输出，不能证明实时产品已经就绪。详见[后端诊断](/zh/avatar/debug-workbench)与[视觉呈现验收](/zh/avatar/visual-acceptance)。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`config/avatar-backend-capability-profile.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-backend-capability-profile.schema.yaml)
- [`config/avatar-mapping-sidecar.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-mapping-sidecar.schema.yaml)
- [`config/avatar-generated-motion-routes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-generated-motion-routes.yaml)
