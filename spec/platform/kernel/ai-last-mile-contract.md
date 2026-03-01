# AI Last Mile Contract

> Owner Domain: `P-ALMI-*`

## P-ALMI-001 — 两段最后一公里

Nimi AI last mile 同时满足两段能力：关系连续性（World + Agent + Memory）与能力接入标准化（Local AI Runtime + Mod）。两段必须同时成立。

## P-ALMI-002 — Hook Action Fabric

`MUST`: Hook Action Fabric 建立在现有 Hook（event-bus/data-api/ui-extension/turn-hook/inter-mod）之上的 Action 粒度注册协议。不是新 Hook 类型。Action 执行走既有 Hook Runtime 与权限/审计边界。Mod 只声明 Action schema 与 handler，runtime 封装治理策略。

## P-ALMI-003 — Principal 模型

统一执行主体：Human、NimiAgent、ExternalAgent、Device、Service。`MUST`: 默认最小权限。权限必须绑定条件（时间、场景、额度、设备、有效期）。高风险写操作必须显式同意与审计归因。

## P-ALMI-004 — ExternalAgent 接入规则

`MUST`: ExternalAgent 不等同于 NimiAgent。必须由显式签发有限期授权凭证。所有外部 Agent 调用必须携带 `principalId + issuer + signature`。delegated 模式必须验证 Friendship 前置条件。autonomous 模式独立账号执行。V1 第三方 Agent 固定走 ExternalAgent Principal。

## P-ALMI-010 — Hook Action 契约

Action Registry 最少包含：actionId、inputSchema、outputSchema、riskLevel (low|medium|high)、executionMode (full|guarded|opaque)、idempotent、supportsDryRun、auditEventMap、compensation。`MUST`: opaque 模式固定 supportsDryRun=false。high risk 不得以 opaque 模式注册。

## P-ALMI-011 — 执行协议状态机

AI 调用标准协议：discover → dry-run → verify → commit → audit。`MUST`: 写操作必须支持 idempotencyKey。多动作编排必须支持补偿（SAGA）。verify 必须先于 commit。commit 必须持久化 execution ledger。持久化不确定时 fail-close。

执行等级矩阵：full（必须 dry-run，commit 后可验证）、guarded（允许 preflight 代替，强审计）、opaque（必须持久审计，high risk 禁止）。

## P-ALMI-020 — AI Runtime 约束

`MUST`: route source 固定 `local-runtime | token-api`。回退必须显式可见。本地隐私语义仅在 local-runtime 路由下成立。

## P-ALMI-030 — 性能与可用性红线

控制面与数据面必须分离。策略与授权决策应本地缓存。审计写入默认异步。Action 控制面附加开销 p95 <= 20ms。只读低风险动作策略异常时可降级（受控 fail-open）。高风险写动作默认 fail-close。
