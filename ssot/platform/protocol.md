---
title: Platform Protocol Spec Skeleton
status: FROZEN
created_at: 2026-02-24
updated_at: 2026-02-24
parent: INDEX.md
rules:
  - This SSOT is maintained in @nimiplatform/nimi and follows no-legacy mode.
  - Changes must preserve traceability to source and contract-level acceptance gates.
---
---

# Platform Protocol (V0.1 必填骨架)

## 0. 文档定位（必填）

本文件是当前开源阶段的协议设计骨架，目标是把平台协议推进到“可编码、可验证”的状态。

- 当前状态：`FROZEN`
- 用途：后续提升为 SSOT 前的协议冻结草案
- 非目标：不定义任意单个 World 的业务剧情和 UI 细节

## 1. 目标与边界（必填）

**目标**：定义跨 `realm / runtime / app` 的统一交互协议。  
**边界**：只定义合同层、版本协商、错误码、审计与合规测试，不替代领域建模文档。

### 1.1 交互对象与分层（MUST）

`Platform Protocol` 不是单一链路协议，而是分层交互约定：

| 层 | 交互对象 | 关注点 |
|---|---|---|
| `L0 Core Envelope` | 任意参与方 <-> 任意参与方 | trace/idempotency/error/audit 基础封装 |
| `L1 Runtime Access` | `runtime <-> app/external` | AI 运行时访问、授权、会话、App 间受控访问 |
| `L2 Realm Core Profile` | `realm <-> app` | world/agent/memory/social/economy 与六原语（realm 专属） |

### 1.2 本文覆盖范围（V0.1）

本文件在 V0.1 覆盖：

1. `L0 Core Envelope`（统一封装、版本、错误、审计）。
2. `L2 Realm Core Profile`（含六原语 realm 专属合同）。
3. `L1 Runtime Access` 的最小跨文档锚点（`app-auth`）。

本文件不覆盖：

1. realm 业务域的完整 API（由 realm-domain 文档与 OpenAPI 合同定义）。
2. runtime RPC 细节（由 `ssot/runtime/service-contract.md` 与 `ssot/sdk/design.md` 定义）。
3. 任意单个 World 的剧情、UI、玩法实现细节。

### 1.3 参与方分类（V0.1）

- 固定参与方（能力基线相对稳定）：`Realm`, `Runtime`
- 可变参与方（能力随产品变化）：`App`
- App 在产品层可分为：
  - `render-app`（只读渲染）
  - `extension-app`（World 扩展写入）

### 1.4 职责矩阵（必填）

| 参与方 | L0 Core Envelope | L1 Runtime Access | L2 Realm Core Profile |
|------|------------------|-------------------|-----------------------|
| Realm | 必须 | 可选（通常不直接） | 必须（唯一真相与执行） |
| Runtime | 必须 | 必须 | 仅消费，不可替代执行 |
| App | 必须 | 按接入模式 | 仅消费，不可替代执行 |

补充规则：

1. `MUST`：所有参与方都通过 L0。
2. `MUST`：六原语的语义执行与真相源必须锁定在 Realm。
3. `MUST`：非 Realm 参与方不得声明六原语 `PROVIDER`（拒绝：`REALM_PRIMITIVE_PROVIDER_FORBIDDEN`）。
4. `MUST`：Runtime/App 对六原语仅可消费与透传，不可替代执行。
5. `MUST`：App 按声明 mode 执行域访问；mode 与域/scope/worldRelation 不匹配时必须拒绝并返回模式违规 reasonCode。

### 1.5 App 授权域边界（ExternalPrincipal 场景）

1. ExternalPrincipal 访问 App 的授权属于 `L1 Runtime Access` 的 `app accessibility` 域，不属于 realm 登录域。
2. `MUST`：App 是授权策略决策点（允许哪些 scope/委托能力）。
3. `MUST`：Runtime 是访问 token 的签发与校验执行点。
4. `MUST`：SDK 负责 scope catalog 定义/版本发布与授权协议封装，不作为最终签发者。
5. `MUST`：同一 ExternalPrincipal 访问不同 App 必须使用不同 App 访问 token。
6. `SHOULD`：默认一个 `externalPrincipal-app` 组合只发一个主 token；不强制按 scope 拆分多 token。
7. `MUST`：授权执行按业务域落地：`app-auth/runtime.*` 由 Runtime 执行，`realm.*` 由 Realm 执行。
8. `MUST`：SDK 本地判定不构成授权生效，必须以 Runtime/Realm 的执行结果为准。

## 2. 版本与协商（必填）

### 2.1 版本字段

- `protocolVersion`：平台协议版本（`major.minor.patch`）
- `participantProtocolVersion`：参与方声明版本（`major.minor.patch`）
- `compatMode`：`strict`（V1 固定）
- `capabilityProfileRef`：固定参与方能力画像引用（如 `realm.core-profile.v1.2`）
- `primitiveCapabilitySchemaVersion`：六原语能力声明结构版本（`major.minor.patch`）
- `domainCapabilitySchemaVersion`：跨域能力声明结构版本（`major.minor.patch`）
- `scopeCatalogVersion`：授权请求使用的目录版本（由 SDK scope catalog 生成管线发布）
- `issuedScopeCatalogVersion`：token 签发时绑定的目录版本（由 Runtime 写入 token 描述）

### 2.2 协商规则（V1 strict-only）

1. `MUST`：`major` 不一致直接拒绝。
2. `MUST`：`participant.minor != platform.minor` 直接拒绝（V1 不做跨 minor 协商）。
3. `MUST`：`patch` 仅用于实现修订，不影响协议语义判定。
4. `MUST`：Realm/Runtime 必须提供 `capabilityProfileRef`，不采用手工动态原语声明。
5. `MUST`：非 Realm 参与方声明六原语 `PROVIDER` 时拒绝（`REALM_PRIMITIVE_PROVIDER_FORBIDDEN`）。
6. `MUST`：授权请求中的 `scopeCatalogVersion` 不可解析或未发布时拒绝（`CAPABILITY_CATALOG_MISMATCH` / `APP_SCOPE_CATALOG_UNPUBLISHED`）。
7. `MUST`：请求 envelope 的字段组合必须符合 domain 规则，否则拒绝（`PROTOCOL_ENVELOPE_INVALID`）。
8. `MUST`：V1 仅接受 `compatMode=strict`，不允许 `legacy-readonly`。
9. `MUST`：固定参与方 profile 必须随版本静态发布，不允许远程动态热下发。
10. `MUST`：Realm 六原语采用单一 `realm.core-profile` 版本轨，不拆分多 profile 并行轨。
11. `MUST`：不支持 per-primitive 独立版本轨；原语 `version` 仅随 profile 版本统一演进。

### 2.3 协商输出（最小返回）

- `accepted: boolean`
- `effectiveProtocolVersion: string`
- `compatMode: string`
- `reasonCode: string`
- `actionHint: string`
- `requiredActions: string[]`

## 3. 协议统一封装（必填）

### 3.1 请求封装

```json
{
  "protocolVersion": "1.0.0",
  "participantProtocolVersion": "1.0.0",
  "participantId": "prt_...",
  "appId": "app_...",
  "domain": "world-primitive|app-auth",
  "worldId": "01H...",
  "principalType": "human|nimi-agent|external-agent|external-app|external-service|device|service",
  "primitive": "timeflow|social|economy|transit|context|presence",
  "operation": "string",
  "principalId": "acc_...",
  "traceId": "trc_...",
  "idempotencyKey": "idem_...",
  "payload": {}
}
```

字段组合规则：

1. `MUST`：`domain=world-primitive` 时必须提供 `worldId + primitive`。
2. `MUST`：`domain=app-auth` 时 `primitive` 必须为空，`appId` 必填，`worldId` 可为空。
3. `MUST`：所有请求必须提供 `participantId`。
4. `MUST`：所有写操作必须提供 `idempotencyKey`。
5. `MUST`：非 Realm 参与方不得以 `world-primitive` 域执行原语写入（`REALM_PRIMITIVE_PROVIDER_FORBIDDEN`）。

### 3.1.1 L0 Envelope 到 gRPC 映射（必填）

`MUST`：L0 字段通过 gRPC metadata 透传，业务 payload 走 proto body。

- `x-nimi-protocol-version` -> `protocolVersion`
- `x-nimi-participant-protocol-version` -> `participantProtocolVersion`
- `x-nimi-participant-id` -> `participantId`
- `x-nimi-domain` -> `domain`
- `x-nimi-app-id` -> `appId`
- `x-nimi-trace-id` -> `traceId`
- `x-nimi-idempotency-key` -> `idempotencyKey`

### 3.2 响应封装

```json
{
  "ok": true,
  "domain": "world-primitive|app-auth",
  "reasonCode": "ACTION_EXECUTED",
  "actionHint": "none",
  "traceId": "trc_...",
  "auditId": "aud_...",
  "output": {}
}
```

### 3.3 能力画像（固定，不做可变声明）

Realm profile（六原语唯一执行方）：

```json
{
  "protocolVersion": "1.0.0",
  "participantProtocolVersion": "1.0.0",
  "participantId": "realm",
  "capabilityProfileRef": "realm.core-profile.v1.0.0",
  "primitiveCapabilities": [
    { "primitive": "timeflow", "mode": "PROVIDER", "version": "1.0.0" },
    { "primitive": "social", "mode": "PROVIDER", "version": "1.0.0" },
    { "primitive": "economy", "mode": "PROVIDER", "version": "1.0.0" },
    { "primitive": "transit", "mode": "PROVIDER", "version": "1.0.0" },
    { "primitive": "context", "mode": "PROVIDER", "version": "1.0.0" },
    { "primitive": "presence", "mode": "PROVIDER", "version": "1.0.0" }
  ]
}
```

Runtime profile（运行时访问层）：

```json
{
  "protocolVersion": "1.0.0",
  "participantProtocolVersion": "1.0.0",
  "participantId": "runtime_local",
  "capabilityProfileRef": "runtime.access-profile.v1.0.0",
  "scopeCatalogVersion": "1.0.0",
  "domainCapabilities": [
    { "domain": "app-auth", "mode": "PROVIDER", "version": "1.0.0" }
  ]
}
```

规则：

1. `MUST`：Realm/Runtime 通过固定 `capabilityProfileRef` 发布能力，不使用可变参与方动态声明。
2. `MUST`：六原语 `PROVIDER` 仅允许 `participantId=realm`。
3. `MUST`：非 Realm 的六原语 `PROVIDER` 声明拒绝（`REALM_PRIMITIVE_PROVIDER_FORBIDDEN`）。
4. `MUST`：授权签发阶段必须验证 `scopeCatalogVersion` 为已发布可解析版本；校验阶段使用 `issuedScopeCatalogVersion + 撤销索引` 判定。

### 3.4 App 访问授权合同（ExternalPrincipal -> App）

本节是授权语义规范真相源（normative source）。

说明：本节是 `L1 Runtime Access` 的跨文档最小锚点，完整 RPC 细节以 `ssot/runtime/service-contract.md` 为准；SDK 细节以 `ssot/sdk/*` 为唯一真相源。

职责补充：
1. SDK 维护 scope catalog 与 preset 映射，作为授权请求构造层的唯一发布面。
2. Runtime/Realm 按业务域执行授权校验，SDK 不执行最终授权。
3. App 自有能力 scope 通过 SDK 扩展声明并并入 catalog，执行仍由 Runtime/Realm 完成。
4. Runtime 侧授权策略创建与 token 签发必须是单事务调用，不允许双 RPC 半成功状态。
5. 非 protocol 文档（architecture/runtime/sdk）只允许补充执行投影，不得改写本节语义约束。

### 3.4.1 Scope 扩展 manifest 发布/审核机制（已决策）

V1 采用 SDK 单入口模型：App 通过 `nimi-sdk scope` 模块扩展自定义 scope，即完成注册与分发入口。

最小 manifest（示例）：

```json
{
  "appId": "app_a",
  "manifestVersion": "1.0.0",
  "scopes": [
    "app.app_a.chat.read",
    "app.app_a.chat.write"
  ],
  "presetHints": {
    "readOnly": ["app.app_a.chat.read"],
    "full": ["app.app_a.chat.read", "app.app_a.chat.write"],
    "delegate": ["app.app_a.chat.read", "app.app_a.chat.write"]
  }
}
```

规则：
1. `MUST`：扩展 scope 仅允许 `app.<appId>.*` 命名空间。
2. `MUST`：禁止扩展 manifest 声明或覆盖 `realm.*`、`runtime.*`、`platform.*`。
3. `MUST`：App 授权页与 external principal 的 scope 查询都必须读取 SDK 发布 catalog，不读取 app 私有副本。
4. `MUST`：发布前必须通过 SDK 自动审核（schema、命名空间、冲突、preset 映射、版本规则一致性）。
5. `MUST`：审核通过后才可发布新的 `scopeCatalogVersion`，Runtime/Realm 仅接受已发布版本。
6. `MUST`：审核失败必须拒绝发布并返回可执行 `actionHint`。
7. `MUST`：扩展 scope 被撤销后，后续 catalog 版本必须移除该 scope；旧版本 token 在校验链路上拒绝。
8. `MUST`：V1 不设独立人工审核流，审核语义由 SDK 规则引擎固定执行。

### 3.4.2 Local Broker 授权边界（FUTURE，占位）

目标：为未来 browser/mod/renderer 访问本地模型保留协议位置；当前阶段不纳入本规范的强制执行范围。

预留要点（启用时再升级为 normative）：
1. `brokerGrant` 与 `iss/aud/origin/appId/effectiveScopes/exp/jti` 绑定。
2. broker 校验签名/origin/exp/jti，并执行防重放。
3. broker 仅放行本地模型能力，不代理 `token-api`，不透传云端密钥字段。
4. 拒绝路径保留可审计 `traceId`。

授权策略声明（由 App 通过 SDK 提交给 Runtime）：

```json
{
  "appId": "app_a",
  "externalPrincipalId": "ext_principal_1",
  "externalPrincipalType": "external-agent|external-app|external-service",
  "subjectUserId": "usr_...",
  "consentId": "cons_...",
  "consentVersion": "1.0",
  "decisionAt": "2026-02-24T10:00:00Z",
  "policyMode": "preset|custom",
  "policyVersion": "1.0.0",
  "preset": "readOnly|full|delegate",
  "scopes": [
    "app.app_a.chat.read",
    "app.app_a.chat.write"
  ],
  "scopeCatalogVersion": "1.0.0",
  "resourceSelectors": {
    "conversationIds": ["conv_1"],
    "timeRange": { "from": "2026-02-01T00:00:00Z", "to": "2026-02-24T00:00:00Z" }
  },
  "canDelegate": false,
  "maxDelegationDepth": 0,
  "ttlSeconds": 86400
}
```

Runtime 签发访问 token（一次性 secret）：

```json
{
  "tokenId": "atk_...",
  "appId": "app_a",
  "externalPrincipalId": "ext_principal_1",
  "externalPrincipalType": "external-app",
  "effectiveScopes": [
    "app.app_a.chat.read",
    "app.app_a.chat.write"
  ],
  "issuedScopeCatalogVersion": "1.0.0",
  "resourceSelectors": {
    "conversationIds": ["conv_1"]
  },
  "consentRef": {
    "subjectUserId": "usr_...",
    "consentId": "cons_...",
    "consentVersion": "1.0"
  },
  "policyVersion": "1.0.0",
  "canDelegate": false,
  "expiresAt": "2026-02-25T12:00:00Z"
}
```

示例场景：
1. `external-agent`：OpenClaw 访问聊天 App 的 `app.app_a.chat.read` / `app.app_a.chat.reply`。
2. `external-app`：小说生成 App 访问聊天 App 的 `app.app_a.chat.read`（仅指定会话范围）。

统一模型（普通/高级）：

1. 普通模式：`preset` 三选一（`readOnly | full | delegate`）。
2. 高级模式：`custom`（同一模型下自定义 scopes/TTL/委托限制）。
3. `MUST`：普通与高级共用一套 token 结构与校验链路，不得维护两套协议。
4. `MUST`：`custom` 策略允许资源级约束（`resourceSelectors`），并在 runtime 侧强制执行。
5. `MUST`：授权决策必须包含可审计同意证据（`subjectUserId + consentId + consentVersion + decisionAt`）。

委托规则（可选）：

1. `MUST`：仅 `canDelegate=true` 的父 token 可申请子 token。
2. `MUST`：子 token scopes 必须是父 token 子集。
3. `MUST`：子 token 的 `expiresAt` 必须早于父 token。
4. `MUST`：父 token 撤销时子 token 级联失效。
5. `MUST`：`preset=delegate` 默认 `maxDelegationDepth=1`（仅单跳委托）。
6. `MUST`：子 token 的 `resourceSelectors` 必须是父 token 资源范围的子集。
7. `MUST`：`preset=delegate` 默认不允许二次委托（第二次委托请求拒绝）。

策略更新规则：

1. `MUST`：App 授权策略更新后，既有主 token 与其子 token 必须立即失效。
2. `MUST`：访问时若 `token.policyVersion` 与当前策略版本不一致，必须拒绝（`APP_GRANT_INVALID` 或 `APP_TOKEN_REVOKED`）。

catalog 规则：

1. `MUST`：仅发布新 catalog 版本（未撤销 scope）不得导致既有 token 自动失效。
2. `MUST`：token 校验以 `issuedScopeCatalogVersion` 解析 scope 集合，再叠加当前撤销索引判定。
3. `MUST`：若 token 命中已撤销/移除 scope，必须拒绝（`APP_SCOPE_REVOKED`）。

### 3.5 World 与 App 的产品关系（必填）

本层是产品绑定关系，不等同于 `app-auth` 授权链路。

二分模型：

1. `render-app`（读渲染）：
   - 不需要 World 级绑定。
   - 不需要 Creator 额外授权。
   - 只能读取 World 可见内容，不得写入 World 核心结构。
2. `extension-app`（世界扩展）：
   - 由 World 主动绑定 `appId`（固定 `1:1`）。
   - 绑定后才允许执行 World 扩展写入（如 dataset/agents/lorebook/world-config）。
   - Creator 可随时变更/暂停/解除绑定。

最小绑定结构（World 主动绑定）：

```json
{
  "worldId": "wld_car_world",
  "extensionAppId": "app_racing_world",
  "bindingMode": "ONE_TO_ONE_EXTENSION",
  "bindingStatus": "active|suspended|revoked",
  "extensionVersion": "1.0.0",
  "extensionWriteScopes": [
    "realm.world.extension.dataset.write",
    "realm.world.extension.agent.write",
    "realm.world.extension.lorebook.write"
  ],
  "updatedBy": "creator_user_id",
  "updatedAt": "2026-02-24T10:00:00Z"
}
```

约束：

1. `MUST`：`render-app` 发起 World 写操作时拒绝（`WORLD_RENDER_WRITE_FORBIDDEN`）。
2. `MUST`：`extension-app` 写入前必须存在 world 绑定记录，否则拒绝（`WORLD_EXTENSION_BINDING_REQUIRED`）。
3. `MUST`：`extension-app` 写入前必须命中 `worldId + extensionAppId + bindingStatus=active`。
4. `MUST`：`bindingStatus != active` 时拒绝（`WORLD_EXTENSION_NOT_ACTIVE`）。
5. `MUST`：绑定不匹配时拒绝（`WORLD_EXTENSION_APP_MISMATCH`）。
6. `MUST`：同一 `worldId` 在任意时刻仅允许一个 `bindingStatus=active` 的 `extensionAppId`（固定 `1:1`）。
7. `MUST`：换绑必须先使当前绑定进入 `suspended|revoked`，再激活新的绑定记录，不允许双活。

## 4. 六原语合同（必填）

适用前提：

1. 以下字段与规则由 Realm 定义并执行，属于 `L2 Realm Core Profile`。
2. Runtime/App 只能消费 Realm 的判定结果，不可替代执行。
3. 非 Realm 参与方尝试执行六原语写操作必须拒绝（`REALM_PRIMITIVE_PROVIDER_FORBIDDEN`）。

### 4.1 Timeflow 合同

| 字段 | 类型 | 约束 |
|------|------|------|
| `ratio` | number | `>0` 且 `<=1440` |
| `tickSeconds` | int | `1..3600` |
| `driftBudgetSecondsPerHour` | int | `0..120` |
| `catchUpPolicy` | enum | `PAUSE | FAST_FORWARD` |
| `rewindAllowed` | boolean | V0.1 固定 `false` |

规则：
- 世界时间必须单调。
- 时间漂移超预算必须触发审计事件。
- 回放时 Timeflow 结果必须可复现。

### 4.2 Social 合同

| 字段 | 类型 | 约束 |
|------|------|------|
| `relationshipTypes` | enum[] | 至少包含 `HUMAN_HUMAN`、`HUMAN_AGENT` |
| `preconditionModel` | enum | `FRIENDSHIP_GATE | OPEN` |
| `reputationScale` | object | 必填 `min/max` |
| `decayWindowHours` | int | `>=1` |
| `blockPolicy` | enum | `HARD_DENY | SOFT_DENY` |

规则：
- 社交准入必须可判定，拒绝必须可解释。
- 关系衰减必须可回放。
- 跨 World 关系映射必须声明规则。
- V0.1 默认真相源为 Realm。

### 4.3 Economy 合同

| 字段 | 类型 | 约束 |
|------|------|------|
| `currencyNamespace` | string | 全局稳定命名 |
| `transferMode` | enum | `DIRECT | ESCROW` |
| `settlementWindowSeconds` | int | `60..86400` |
| `conservationRequired` | boolean | V0.1 固定 `true` |
| `inflationPolicy` | enum | `FIXED_CAP | PROGRAMMATIC` |

规则：
- 价值流转必须满足守恒约束。
- 结算窗口必须固定且可审计。
- 跨 World 结算映射必须可解释。
- V0.1 默认真相源为 Realm。

### 4.4 Transit 合同

| 字段 | 类型 | 约束 |
|------|------|------|
| `ingressUserQuotaPerDay` | int | `>=0` |
| `ingressWorldQuotaPerDay` | int | `>=0` |
| `carryPolicy` | enum | `IDENTITY_ONLY | IDENTITY_AND_AGENT | FULL` |
| `mappingPolicy` | enum | `STRICT_MAP | ADAPTIVE_MAP` |
| `transitStateModel` | enum | `ACTIVE_COMPLETED_ONLY`（V0.1） |

规则：
- Transit 必须满足双闸准入（用户闸 + 世界闸）。
- 状态转换必须合法且可追溯。
- 任意拒绝必须返回可执行 `actionHint`。

### 4.5 Context 合同

| 字段 | 类型 | 约束 |
|------|------|------|
| `contextScope` | enum | `SESSION | WORLD | DEVICE` |
| `retentionTtlSeconds` | int | `>=60` |
| `injectionPriority` | string[] | 必填且有序 |
| `truncationPolicy` | enum | `SUMMARY_FIRST | RECENCY_FIRST` |
| `handoffPolicy` | enum | `EXPLICIT_ONLY | ASSISTED` |

规则：
- 上下文裁剪必须可观测。
- 注入优先级必须稳定。
- handoff 必须带审计信息。

### 4.6 Presence 合同

| 字段 | 类型 | 约束 |
|------|------|------|
| `presenceStates` | enum[] | 至少包含 `ACTIVE/IDLE/AWAY/OFFLINE` |
| `heartbeatSeconds` | int | `5..120` |
| `ttlSeconds` | int | `>= heartbeatSeconds * 2` |
| `staleTransition` | enum | `FORCE_OFFLINE`（V0.1） |
| `deviceMergePolicy` | enum | `LATEST_WINS | PRIORITY_ORDER` |

规则：
- Presence 状态必须可恢复。
- 过期状态必须自动收敛。
- 跨设备冲突必须有确定性合并策略。

## 5. 跨原语一致性规则（必填）

适用条件：仅对本次请求链路中 Realm 实际参与执行的原语生效。

1. `MUST`：Transit 结果必须同时满足 Social + Economy + Context 约束。
2. `MUST`：Presence 变化不得绕过 Social 准入。
3. `MUST`：Timeflow 不得破坏 Economy 结算窗口定义。
4. `MUST`：Context 注入不得覆盖 Identity/Agent 核心锚点。
5. `MUST`：未执行原语不得以静默降级方式绕过准入规则。

## 6. 最小错误码集合（必填）

| 分组 | reasonCode |
|------|------------|
| 版本 | `PROTOCOL_MAJOR_MISMATCH`, `PROTOCOL_MINOR_UNSUPPORTED`, `PROTOCOL_VERSION_MISSING` |
| 能力画像 | `CAPABILITY_PROFILE_MISSING`, `CAPABILITY_MODE_INVALID`, `PRIMITIVE_NOT_SUPPORTED`, `DOMAIN_NOT_SUPPORTED`, `CAPABILITY_CATALOG_MISMATCH`, `REALM_PRIMITIVE_PROVIDER_FORBIDDEN` |
| 协议封装 | `PROTOCOL_ENVELOPE_INVALID`, `PROTOCOL_DOMAIN_FIELD_CONFLICT` |
| App 授权 | `APP_AUTHORIZATION_DENIED`, `APP_GRANT_INVALID`, `APP_TOKEN_EXPIRED`, `APP_TOKEN_REVOKED`, `APP_SCOPE_FORBIDDEN`, `APP_DELEGATION_FORBIDDEN`, `APP_DELEGATION_DEPTH_EXCEEDED`, `EXTERNAL_PRINCIPAL_PROOF_MISSING`, `EXTERNAL_PRINCIPAL_PROOF_INVALID` |
| Scope 扩展 | `APP_SCOPE_MANIFEST_INVALID`, `APP_SCOPE_NAMESPACE_FORBIDDEN`, `APP_SCOPE_CONFLICT`, `APP_SCOPE_CATALOG_UNPUBLISHED`, `APP_SCOPE_REVOKED` |
| App 模式 | `APP_MODE_DOMAIN_FORBIDDEN`, `APP_MODE_SCOPE_FORBIDDEN`, `APP_MODE_WORLD_RELATION_FORBIDDEN`, `APP_MODE_MANIFEST_INVALID` |
| App 资源与同意 | `APP_RESOURCE_SELECTOR_INVALID`, `APP_RESOURCE_OUT_OF_SCOPE`, `APP_CONSENT_MISSING`, `APP_CONSENT_INVALID` |
| World-App 绑定 | `WORLD_RENDER_WRITE_FORBIDDEN`, `WORLD_EXTENSION_BINDING_REQUIRED`, `WORLD_EXTENSION_APP_MISMATCH`, `WORLD_EXTENSION_NOT_ACTIVE` |
| 准入 | `SOCIAL_PRECONDITION_FAILED`, `TRANSIT_USER_QUOTA_EXCEEDED`, `TRANSIT_WORLD_QUOTA_EXCEEDED` |
| 状态机 | `TRANSIT_STATE_INVALID`, `PRESENCE_STATE_INVALID`, `TIMEFLOW_NON_MONOTONIC` |
| 一致性 | `ECONOMY_CONSERVATION_FAILED`, `CONTEXT_TRUNCATION_UNTRACKED`, `PRIMITIVE_CONTRACT_INVALID` |
| 权限 | `PRINCIPAL_UNAUTHORIZED`, `ACTION_FORBIDDEN` |

模式违规 `actionHint` 默认映射：
- `APP_MODE_DOMAIN_FORBIDDEN`
  - `lite (realm-only)` 命中 `runtime.*` -> `remove_runtime_scopes_or_switch_mode_full`
  - `core-only (runtime-only)` 命中 `realm.*` -> `remove_realm_scopes_or_switch_mode_full`
- `APP_MODE_SCOPE_FORBIDDEN` -> `adjust_scopes_for_app_mode`
- `APP_MODE_WORLD_RELATION_FORBIDDEN` -> `set_world_relation_render_or_none_or_switch_mode`
- `APP_MODE_MANIFEST_INVALID` -> `fix_mode_manifest_and_resubmit`

## 7. 审计合同（必填）

### 7.1 事件最小集合

- `protocol_validation_failed`
- `transit_denied`
- `economy_settlement_applied`
- `context_handoff_applied`
- `presence_state_changed`
- `timeflow_drift_exceeded`
- `app_authorization_granted`
- `app_token_issued`
- `app_token_delegated`
- `app_token_revoked`
- `scope_manifest_registered`
- `scope_manifest_validation_failed`
- `scope_catalog_published`
- `scope_catalog_revoked`
- `app_mode_violation_denied`
- `app_resource_scope_denied`
- `app_consent_validation_failed`
- `world_extension_bound`
- `world_extension_unbound`
- `world_extension_write_denied`

### 7.2 审计字段（MUST）

- `participantId`
- `capabilityProfileRef`
- `scopeCatalogVersion`
- `issuedScopeCatalogVersion`
- `domain`
- `worldId`（`domain=world-primitive` 时必填）
- `appId`（`domain=app-auth` 时必填）
- `extensionAppId`（World 扩展链路时必填）
- `bindingStatus`（World 扩展链路时必填）
- `principalId`
- `principalType`
- `primitive`（`domain=world-primitive` 时必填）
- `capabilityMode`（原语域请求时必填）
- `tokenId`
- `parentTokenId`
- `subjectUserId`
- `consentId`
- `consentVersion`
- `policyPreset`
- `policyVersion`
- `resourceSelectorHash`
- `protocolVersion`
- `reasonCode`
- `traceId`
- `timestamp`

## 8. 合规测试矩阵（必填）

### 8.1 L0 合同层（全体强制）

| 项目 | 正向用例 | 拒绝用例 | 版本回归（strict） |
|------|---------|---------|---------|
| 版本协商 | 必须 | 必须 | 必须 |
| 请求/响应封装 | 必须 | 必须 | 必须 |
| `participantId` 必填校验 | 必须 | 必须 | 必须 |
| domain 字段组合校验 | 必须 | 必须 | 必须 |
| 错误码可解释性 | 必须 | 必须 | 必须 |
| 审计字段完整性 | 必须 | 必须 | 必须 |

### 8.2 L1 能力画像层（全体适用）

| 项目 | 正向用例 | 拒绝用例 | 版本回归（strict） |
|------|---------|---------|---------|
| Realm/Runtime profile 一致性（`capabilityProfileRef`） | 必须 | 必须 | 必须 |
| Realm 六原语 profile 完整性 | 必须 | 必须 | 必须 |
| mode 合法性校验 | 必须 | 必须 | 必须 |
| 非 Realm `PROVIDER` 拒绝校验 | 必须 | 必须 | 必须 |
| `scopeCatalogVersion` 一致性 | 必须 | 必须 | 必须 |

### 8.3 App 授权层（ExternalPrincipal -> App）

| 项目 | 正向用例 | 拒绝用例 | 版本回归（strict） |
|------|---------|---------|---------|
| `AuthorizeExternalPrincipal` 原子签发 | 必须 | 必须 | 必须 |
| `preset(readOnly/full/delegate)` | 必须 | 必须 | 必须 |
| `custom` 策略解析 | 必须 | 必须 | 必须 |
| 同一 ExternalPrincipal 跨 App token 隔离 | 必须 | 必须 | 必须 |
| 非授权 token 访问拒绝 | 必须 | 必须 | 必须 |
| 委托链路（子集 scopes + TTL） | 必须 | 必须 | 必须 |
| 资源级约束（resourceSelectors） | 必须 | 必须 | 必须 |
| 同意证据校验（consent fields） | 必须 | 必须 | 必须 |
| scope/preset 自动映射一致性（read/write -> preset） | 必须 | 必须 | 必须 |
| scope 扩展 manifest 发布/审核/撤销链路 | 必须 | 必须 | 必须 |

### 8.4 World-App 绑定层（产品关系）

| 项目 | 正向用例 | 拒绝用例 | 版本回归（strict） |
|------|---------|---------|---------|
| `render-app` 只读渲染路径 | 必须 | 必须 | 必须 |
| `render-app` 写入拒绝 | 必须 | 必须 | 必须 |
| `extension-app` `worldId+appId` 绑定命中 | 必须 | 必须 | 必须 |
| `extension-app` 无绑定拒绝 | 必须 | 必须 | 必须 |
| `bindingStatus` 状态机（active/suspended/revoked） | 必须 | 必须 | 必须 |
| Creator 变更绑定后的即时生效 | 必须 | 必须 | 必须 |

### 8.5 L2 Realm 六原语层（Realm 强制）

| 原语 | 适用条件 | 正向用例 | 拒绝用例 | 回放一致性 | 版本回归（strict） |
|------|---------|---------|---------|-----------|---------|
| Timeflow | Realm profile | 必须 | 必须 | 必须 | 必须 |
| Social | Realm profile | 必须 | 必须 | 必须 | 必须 |
| Economy | Realm profile | 必须 | 必须 | 必须 | 必须 |
| Transit | Realm profile | 必须 | 必须 | 必须 | 必须 |
| Context | Realm profile | 必须 | 必须 | 必须 | 必须 |
| Presence | Realm profile | 必须 | 必须 | 必须 | 必须 |

发布门槛：
- 所有参与方 `L0` 全绿
- L1 能力画像校验全绿
- ExternalPrincipal->App 授权链路全绿
- World-App 绑定链路全绿（render + extension）
- Realm 六原语 `L2` 全绿
- 非 Realm 原语执行拒绝路径全绿

## 9. 冻结检查清单（必填）

1. 六原语字段冻结。
2. 错误码冻结。
3. 版本协商策略冻结。
4. 能力画像 schema 冻结。
5. 固定参与方 `capabilityProfileRef` 冻结。
6. scope catalog 自动生成管线冻结。
7. App 授权策略 schema 冻结（preset/custom 同模型）。
8. World-App 绑定 schema 冻结（render/extension + 1:1）。
9. token 委托约束冻结（depth/ttl/subset）。
10. L0/L1/L2 合规门槛冻结。
11. 合规测试入口冻结。
12. 审计事件字典冻结。
13. 执行结果与证据归档必须写入 `dev/report/*`，不得在 SSOT 以勾选状态记录。

## 10. 决策收敛（必填）

### 10.1 已决策（2026-02-24）

- [否] 是否允许 `legacy-readonly` 在 V1 上线
- [否] 是否需要 per-primitive 独立版本号
- [否] 固定参与方 profile 是否需要远程动态下发
- [否] Realm 六原语 profile 是否需要拆分为多 profile 版本轨
- [不允许] `delegate` preset 默认是否允许二次委托
- [是] App 授权策略更新是否立即使既有 token 失效
- [否] World `extension-app` 是否从 `1:1` 演进到 `1:N`
- [是] scope catalog 扩展 manifest 是否采用 `nimi-sdk scope` 单入口注册与自动审核发布

### 10.2 待定项

- 当前无待定项（新增待定需先写入 `INDEX.md` 决策记录）。
