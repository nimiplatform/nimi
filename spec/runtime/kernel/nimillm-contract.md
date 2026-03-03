# Runtime nimiLLM Contract

> Owner Domain: `K-NIMI-*`

## K-NIMI-001 Module Boundary

nimiLLM 负责 remote 执行适配，不承担 connector 持久化职责。

## K-NIMI-002 Provider Adapter Layering

provider 适配必须分层：请求映射、响应归一化、错误归一化。

## K-NIMI-003 Model Prefix Responsibility

model_id 前缀与 provider 匹配校验必须在进入 provider 出站前完成。

## K-NIMI-004 Media Job Responsibility

媒体任务的提交与查询必须遵循 MediaJob 契约，不得绕开 job 元数据语义。

## K-NIMI-005 Endpoint Security Delegation

remote 出站 endpoint 安全校验必须遵循 endpoint-security 约束。

## K-NIMI-006 Streaming Alignment

文本/语音流事件必须遵循 `K-STREAM-*` done/终帧语义。

## K-NIMI-007 Audit Alignment

执行入口、路由决策、错误退出必须写入统一审计字段。

## K-NIMI-008 Route Visibility

routePolicy、backendName、fallback 决策必须可观测。

## K-NIMI-009 Unsupported Modality

不支持的能力必须显式返回 `AI_MODALITY_NOT_SUPPORTED`。

## K-NIMI-010 Availability & Fallback

可用性门控与 fallback 必须显式，禁止静默降级。
