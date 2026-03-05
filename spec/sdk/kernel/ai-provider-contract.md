# SDK AI Provider Contract

> Owner Domain: `S-AIP-*`

## S-AIP-001 Adapter Role

ai-provider 子路径是协议适配层，不承担 runtime/provider 路由决策。

## S-AIP-002 Media Job Projection

ScenarioJob 相关方法必须保持提交/查询/取消/订阅语义一致性。

## S-AIP-003 Stream Finish Projection

流式 done/finish reason 必须完整投影给调用方，不得静默吞掉业务终态。

## S-AIP-004 Provider Catalog Alignment

provider 名称与能力对齐以 runtime `provider-catalog.yaml` 为事实源。

## S-AIP-005 Error Projection Coupling

ai-provider 的错误投影必须复用 `S-ERROR-*`，不得私自扩展冲突语义。
