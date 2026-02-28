# Local Category & Capability Contract

> Owner Domain: `K-LOCAL-*`

## K-LOCAL-001 固定 category（Phase 1）

`LocalConnectorCategory` 固定 6 个：

1. `LLM`
2. `VISION`
3. `IMAGE`
4. `TTS`
5. `STT`
6. `CUSTOM`

## K-LOCAL-002 capability 映射（Phase 1）

- `LLM` 承载 `CHAT` 与 `EMBEDDING`。
- `VISION` 表示“可接受视觉输入”的能力标记，不是独立执行模态。
- `IMAGE/TTS/STT` 与同名执行模态映射。
- `CUSTOM` 的 capability 来自模型元数据声明。

## K-LOCAL-003 CUSTOM 可用性门槛

`CUSTOM` 模型缺失 `local_invoke_profile_id` 时：

- 必须标记 `available=false`
- 调用返回 `FAILED_PRECONDITION` + `AI_LOCAL_MODEL_PROFILE_MISSING`

## K-LOCAL-004 category 与路由解耦

connector 层是薄描述，不承载用户路由策略。具体执行路由由模型级元数据与执行模块决定。

## K-LOCAL-005 Local 生命周期状态机锚点

`local_model_lifecycle` 与 `local_service_lifecycle` 的状态与迁移来源由 `tables/state-transitions.yaml` 固定：

- 状态集合：`installed` `active` `unhealthy` `removed`
- 迁移触发：`start/spawn`、`health_probe_failed`、`recovery`、`remove`

任何 local 生命周期文档必须引用本 Rule ID，不得使用章节号样式来源（例如 `local-model_5.1`）。

## K-LOCAL-006 Local 不可用错误映射

当 local category 无可用模型（例如探活失败或无可执行实例）时：

- 探测路径：`ok=false` + `AI_LOCAL_MODEL_UNAVAILABLE`
- 执行路径：`FAILED_PRECONDITION` + `AI_LOCAL_MODEL_UNAVAILABLE`
