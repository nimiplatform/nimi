# SDK AI Provider Contract

> Owner Domain: `S-AIP-*`

## S-AIP-001 Adapter Role

ai-provider 子路径是协议适配层，不承担 runtime/provider 路由决策。

- `createNimiAiProvider({ runtime })` 必须优先复用 `runtime.appId`，允许显式 `appId` override。
- routing/default model 选择权属于 runtime 或调用方；ai-provider 适配层不得引入独立 provider 路由表。

多模态请求验证（video mode/role 矩阵 K-MMPROV-024/025、TTS voice_ref 强类型 K-MMPROV-018、LocalAI 图片工作流 K-MMPROV-016、artifact metadata 校验 K-MMPROV-007）均为 runtime 侧职责。SDK ai-provider 层仅投影 RPC 方法面（`runtime-method-groups.yaml`）和错误结果，不复刻上游请求验证逻辑。

## S-AIP-002 Media Job Projection

ScenarioJob 相关方法必须保持提交/查询/取消/订阅语义一致性。

## S-AIP-003 Stream Finish Projection

流式 done/finish reason 必须完整投影给调用方，不得静默吞掉业务终态。

## S-AIP-004 Provider Catalog Alignment

provider 名称与能力对齐以 runtime `provider-catalog.yaml` 为事实源。

## S-AIP-005 Error Projection Coupling

ai-provider 的错误投影必须复用 `S-ERROR-*`，不得私自扩展冲突语义。
