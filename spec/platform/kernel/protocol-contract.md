# Protocol Contract

> Owner Domain: `P-PROTO-*`

## P-PROTO-001 — 版本协商 strict-only

`MUST`: `major` 不一致直接拒绝。`participant.minor != platform.minor` 直接拒绝（V1 不做跨 minor 协商）。`patch` 仅用于实现修订，不影响协议语义判定。V1 仅接受 `compatMode=strict`。

## P-PROTO-002 — Participant Profile 静态发布

`MUST`: Realm/Runtime 必须提供 `capabilityProfileRef`。固定参与方 profile 必须随版本静态发布，不允许远程动态热下发。Realm 六原语采用单一 `realm.core-profile` 版本轨，不拆分多 profile。不支持 per-primitive 独立版本轨。

## P-PROTO-003 — 六原语执行主权

`MUST`: 六原语的语义执行与真相源必须锁定在 Realm。非 Realm 参与方不得声明六原语 `PROVIDER`（拒绝：`REALM_PRIMITIVE_PROVIDER_FORBIDDEN`）。Runtime/App 对六原语仅可消费与透传，不可替代执行。

## P-PROTO-010 — 请求封装字段规则

`MUST`: `domain=world-primitive` 时必须提供 `worldId + primitive`。`domain=app-auth` 时 `primitive` 必须为空，`appId` 必填。所有请求必须提供 `participantId`。所有写操作必须提供 `idempotencyKey`。非 Realm 参与方不得以 `world-primitive` 域执行原语写入。V1 domain 枚举为封闭集：`world-primitive`（世界原语操作）、`app-auth`（应用授权操作）。

## P-PROTO-011 — L0 Envelope gRPC 映射

`MUST`: L0 字段通过 gRPC metadata 透传，业务 payload 走 proto body。字段映射：`x-nimi-protocol-version`, `x-nimi-participant-protocol-version`, `x-nimi-participant-id`, `x-nimi-domain`, `x-nimi-app-id`, `x-nimi-trace-id`, `x-nimi-idempotency-key`, `x-nimi-world-id`（仅 `domain=world-primitive` 时必填）, `x-nimi-primitive`（仅 `domain=world-primitive` 时必填）。

## P-PROTO-020 — App 授权语义规范

`MUST`: App 是授权策略决策点。Runtime 是访问 token 的签发与校验执行点。SDK 负责 scope catalog 定义/版本发布与授权协议封装，不作为最终签发者。同一 ExternalPrincipal 访问不同 App 必须使用不同 App 访问 token。授权执行按业务域落地。

## P-PROTO-021 — Scope 扩展 manifest 规则

`MUST`: 扩展 scope 仅允许 `app.<appId>.*` 命名空间。禁止覆盖 `realm.*`/`runtime.*`/`platform.*`。发布前必须通过 SDK 自动审核。审核通过后才可发布新 `scopeCatalogVersion`。扩展 scope 被撤销后后续 catalog 版本必须移除。

## P-PROTO-030 — App 授权策略原子性

`MUST`: Runtime 侧授权策略创建与 token 签发必须是单事务调用。所有 preset（readOnly/full/delegate）共用一套 token 结构与校验链路。授权决策必须包含可审计同意证据。`custom` 策略允许资源级约束，在 runtime 侧强制执行。

## P-PROTO-035 — 委托规则

`MUST`: 仅 `canDelegate=true` 的父 token 可申请子 token。子 token scopes/resourceSelectors 必须是父 token 子集。子 token `expiresAt` 必须早于父 token。父 token 撤销时子 token 级联失效。`preset=delegate` 默认 `maxDelegationDepth=1`。

## P-PROTO-040 — 策略更新与 catalog 规则

`MUST`: App 授权策略更新后既有 token 立即失效。token 校验以 `issuedScopeCatalogVersion` 解析 scope 集合。命中已撤销 scope 必须拒绝（`APP_SCOPE_REVOKED`）。发布新 catalog 版本不导致既有 token 自动失效。

## P-PROTO-050 — World-App 产品关系

`MUST`: `render-app` 发起 World 写操作时拒绝。`extension-app` 写入前必须存在 world 绑定记录（`worldId + extensionAppId + bindingStatus=active`）。同一 `worldId` 在任意时刻仅允许一个 active 绑定。换绑必须先 suspended/revoked 再激活新绑定。

World-App 绑定状态机：

| 当前状态 | 合法转换 | 触发条件 |
|---------|---------|---------|
| (新建) | active | Creator 首次绑定 extension-app |
| active | suspended | Creator 主动挂起 |
| active | revoked | Creator 主动撤销 |
| suspended | active | Creator 恢复 |
| suspended | revoked | Creator 撤销 |
| revoked | (终态) | 不可恢复，需创建新绑定 |

## P-PROTO-060 — App 模式域边界

`MUST`: App 按声明 mode 执行域访问。mode 与域/scope/worldRelation 不匹配时必须拒绝并返回模式违规 reasonCode。actionHint 默认映射见 `tables/protocol-error-codes.yaml` 中各 error code 的 `action_hint` 字段。

App 模式访问矩阵：

| mode | domain=world-primitive | domain=app-auth | world 绑定要求 |
|------|----------------------|----------------|--------------|
| render-app | 只读 | 允许 | 不要求 |
| extension-app | 读写 | 允许 | 必须 active binding |

## P-PROTO-070 — 跨原语一致性

`MUST`: Transit 结果必须同时满足 Social + Economy + Context 约束。Presence 变化不得绕过 Social 准入。Timeflow 不得破坏 Economy 结算窗口定义。Context 注入不得覆盖 Identity/Agent 核心锚点。未执行原语不得以静默降级方式绕过准入规则。

## P-PROTO-100 — Timeflow 原语合同

字段与规则定义见 `tables/protocol-primitives.yaml` (timeflow)。世界时间必须单调，漂移超预算必须触发审计，回放必须可复现。

## P-PROTO-101 — Social 原语合同

字段与规则定义见 `tables/protocol-primitives.yaml` (social)。准入必须可判定，拒绝必须可解释，衰减必须可回放。

## P-PROTO-102 — Economy 原语合同

字段与规则定义见 `tables/protocol-primitives.yaml` (economy)。价值流转必须守恒，结算窗口必须可审计。

## P-PROTO-103 — Transit 原语合同

字段与规则定义见 `tables/protocol-primitives.yaml` (transit)。双闸准入，状态转换可追溯，拒绝必须返回 actionHint。

## P-PROTO-104 — Context 原语合同

字段与规则定义见 `tables/protocol-primitives.yaml` (context)。裁剪可观测，优先级稳定，handoff 带审计。

## P-PROTO-105 — Presence 原语合同

字段与规则定义见 `tables/protocol-primitives.yaml` (presence)。状态可恢复，过期自动收敛，跨设备确定性合并。
