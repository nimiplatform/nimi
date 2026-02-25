---
title: Nimi AI Last Mile SSOT
status: ACTIVE
version: v1.1
updated_at: 2026-02-25
rules:
  - Nimi 的“AI 最后一公里”必须同时满足两段能力：关系连续性与能力接入标准化。
  - 关系连续性固定由 World（服务端控制面语义）+ Agent + Memory 提供，不允许任一层被临时会话语义替代。
  - 能力接入标准化固定由 Local AI Runtime + Mod 提供，不允许回退到 UI 自动化脚本作为主执行路径。
  - Hook Action Fabric 是现有 Hook 体系上的 Action 粒度注册协议；现有 Hook 类型保持兼容并可逐步收敛。
  - Hook Action 执行模式固定为 `full|guarded|opaque`；`opaque` 为 V1 正式执行等级，不是临时降级态。
  - 人类可执行操作应可映射为 Hook Action；AI 调用默认走 discover → dry-run → verify → commit → audit 协议。
  - Mod 对 Action 的接入必须保持透明：Mod 只声明/调用 Action；授权、前置校验、降级与审计由 runtime 包装治理层统一负责。
  - 执行主体统一为 Principal（Human/NimiAgent/ExternalAgent/Device/Service），权限默认最小化并带条件约束。
  - ExternalAgent 接入支持 delegated/autonomous 两种授权模式；任一模式都不得绕过 L0 Social 与 L0 Runtime 协议约束。
  - V1 第三方 Agent 接入固定走 ExternalAgent Principal，不提供基于 NimiAgent/AgentToken 的并行接入路径。
  - local-runtime 与 token-api 的选择、回退与失败原因必须可见、可审计、可治理。
  - 本地模型接入主路径固定为 Runtime Setup 内的 `Verified + HF Catalog` 搜索/安装/即用闭环；安装计划、自动绑定与回退都必须可见可审计。
  - Local AI Runtime 依赖抽象固定为 `model -> service -> node`，Setup 主路径必须支持依赖解析与一键应用。
  - `ServiceArtifact` 必须采用声明式安装/预检/进程/健康契约；preflight 必须先于大文件下载。
  - AI-first 能力扩展不得破坏 Core 控制面独占写权限与 local-first 运行原则。
  - 性能与可用性预算必须内建到协议：控制面开销可预算、可降级、可观测。
---

# Nimi AI 最后一公里唯一真相（SSOT）

## 1. 目标与边界

本域目标：

1. 给出 Nimi 的统一产品定义：不仅让 AI 认识用户，也让 AI 能力可标准化接入用户生活。
2. 统一 World、Agent、Memory 与 Local AI Runtime、Mod 的跨域关系，避免“各域正确但整体割裂”。
3. 为 Human 与 ExternalAgent 的 AI 一等公民执行模型（AI-first Hook Action Fabric）提供 V1 可执行协议约束。

本域边界：

1. 本文件定义“跨域总语义”，不重写各单域 SSOT 的底层细节。
2. 单域细节仍以各自 SSOT 为准：
   - 世界语义：`ssot/boundaries/world.md`
   - Agent/Memory 语义：`ssot/boundaries/agent.md`
   - 本地 AI 基建：`ssot/runtime/local-runtime.md`
   - Mod 接入边界：`ssot/mod/governance.md`
3. 若跨域与单域表述冲突，以“域边界优先 + 本文件总语义不变”处理。

## 2. 核心定义：两段最后一公里

### 2.1 第一段：关系连续性（AI 认识你）

关系连续性由以下三层共同提供：

1. `World`：世界规则、时间线、上下文与治理约束（服务端世界控制面与状态源）。
2. `Agent`：稳定身份、人格边界、行为策略与归属语义。
3. `Memory`：Core/E2E 记忆分层与可解释召回。

结果：AI 从“每次重置的陌生工具”变成“与用户共享历史的持续存在体”。

### 2.2 第二段：能力接入标准化（AI 接入你的生活）

能力标准化由以下两层共同提供：

1. `Local AI Runtime`：统一模型管理、路由、回退、审计的执行基建。
2. `Mod`：统一能力契约与沙箱扩展生态，业务能力按标准插拔。
3. Runtime 依赖抽象固定 `model -> service -> node`，安装主链固定 `dependencies.resolve -> dependencies.apply`。
4. `ServiceArtifact` 必须承载安装、preflight、启动与健康契约；preflight 失败必须先于下载返回。
5. 借鉴 ComfyUI 的点是“节点契约 + 依赖包装 + 可解释执行”，不引入“用户可编辑节点画布”。

结果：AI 从“孤立 API 能力”变成“可规模化接入日常场景的标准能力网”。

### 2.3 合成价值

只有两段同时成立，Nimi 才成立：

1. 只有关系连续性、没有能力标准化：AI 只能“会聊天”，无法进入生活流程。
2. 只有能力标准化、没有关系连续性：AI 只能“会执行”，却不理解用户语境。
3. 两段同时成立：形成“认识你且能为你做事”的个人 AI 操作底座。

## 3. 跨域组件映射

| 层 | 组件 | 归属域 | 对应 SSOT |
|----|------|--------|-----------|
| 关系层 | World（规则/上下文/治理） | World | `ssot/boundaries/world.md` |
| 关系层 | Agent（身份/行为策略） | Agent | `ssot/boundaries/agent.md` |
| 关系层 | Memory（Core/E2E） | Agent | `ssot/boundaries/agent.md` |
| 能力层 | Local AI Runtime（模型/路由/审计） | Local AI Runtime | `ssot/runtime/local-runtime.md` |
| 能力层 | Mod（能力消费与扩展） | Mod | `ssot/mod/governance.md` |
| 能力细分 | ModelArtifact（纯数据） | Local AI Runtime | `ssot/runtime/local-runtime.md` |
| 能力细分 | ServiceArtifact（运行时环境+进程） | Local AI Runtime | `ssot/runtime/local-runtime.md` |
| 能力细分 | NodeContract（typed capability） | Local AI Runtime | `ssot/runtime/local-runtime.md` |
| 跨域桥 | AI-first Hook Action Fabric | 跨域总语义 | 本文件 |

## 4. AI-first Hook Action Fabric（V1 生效协议）

### 4.1 与现有 Hook 系统的关系

1. Hook Action Fabric 不是新增“第 6 种 Hook 类型”，而是建立在现有 Hook（event-bus/data-api/ui-extension/turn-hook/inter-mod）之上的 Action 粒度注册协议。
2. 现有 Hook 类型保持可用；`data-api` 等能力可按域逐步收敛到 Action Registry，不强制一次性替换。
3. Action 的执行仍走既有 Hook Runtime 与权限/审计边界，不允许旁路直连内部服务。
4. 对 Mod 的稳定语义固定为“透明接入”：Mod 只声明 Action schema 与 handler 能力边界，runtime 统一封装治理策略。

### 4.2 设计目标

1. 让 AI 像“有权限的人类用户”一样操作 Nimi，而不是模拟 UI 点击。
2. 让基于 Nimi Runtime 的 Mod/Extension App 原生暴露 AI 可调用能力。
3. 为外部 Agent（如 OpenClaw）提供可授权、可审计、可治理的稳定接入面。

### 4.3 主体模型（Principal）

统一执行主体：

1. `Human`
2. `NimiAgent`（`Account(role=AGENT) + AgentProfile`）
3. `ExternalAgent`（第三方 Agent 进程，如 OpenClaw）
4. `Device`
5. `Service`

授权规则：

1. 默认最小权限。
2. 权限必须绑定条件（时间、场景、额度、设备、有效期）。
3. 高风险写操作必须显式同意与审计归因。

`ExternalAgent` 最小定义（跨域边界）：

1. `ExternalAgent` 不等同于 Nimi 内生 `NimiAgent`，二者身份模型不可混用。
2. `ExternalAgent` 必须由以下之一显式签发有限期授权凭证（scope/actions、有效期、可吊销）：
   - 账户持有者主 Runtime（本地签发，默认路径）
   - `nimi-realm control-plane`（云端受保护能力授权场景，沿用 grant token 机制扩展）
3. 所有外部 Agent 调用必须携带 `principalId + issuer + signature`，并可追溯到授权与审计链。
4. delegated 模式下（代表用户执行），必须验证 `subjectAccountId=userAccountId` 且用户侧已满足 `Friendship(HUMAN_AGENT, ACTIVE)` 前置条件；授权凭证不可替代该社交关系判定。
5. autonomous 模式下（独立账号执行），必须验证 `subjectAccountId=externalAccountId`；其权限、配额与社交前置条件按该账号独立判定，不得获得隐式超权。
6. 若 autonomous 主体不满足 V1 社交协议允许的聊天类型（如 `AGENT_TO_AGENT` 禁止），调用必须被拒绝并返回 reasonCode。

### 4.4 Action 契约（Hook Action）

所有可执行动作应收敛为 Action Registry，最少包含：

1. `actionId`
2. `inputSchema`
3. `outputSchema`
4. `riskLevel`（`low|medium|high`）
5. `executionMode`（`full|guarded|opaque`）
6. `idempotent`
7. `supportsDryRun`
8. `auditEventMap`
9. `compensation`（可选，跨域写操作必须）

归属与权限映射：

1. Action Registry 由 Runtime 控制面统一管理；Mod 仅在自身命名空间声明/注册可消费动作。
2. Mod 声明的 Action 必须是其 `Manifest capabilities` 的子集，不得声明超权限动作。
3. `riskLevel` 与现有权限模型映射固定：`low -> 标准 Hook`、`medium -> 高风险本地能力（需显式授权）`、`high -> 平台受保护能力（需 grant token）`。
4. `opaque` 模式下固定 `supportsDryRun=false`；`high risk` 动作不得以 `opaque` 模式注册或执行。
5. `compensation` 由动作所属业务域提供与维护，本域只定义“必须存在”的协议要求。

### 4.5 执行协议（统一状态机）

AI 调用标准协议：

1. `discover`
2. `dry-run`
3. `verify`
4. `commit`
5. `audit`

执行要求：

1. 写操作必须支持 `idempotencyKey`；缺失时必须拒绝执行。
2. 多动作编排必须支持补偿与回滚语义（SAGA）。
3. 任一失败必须返回 reasonCode 与 actionHint，不得返回未定义错误。
4. `verify` 必须先于 `commit`；`commit` 必须校验 `verifyTicket`（若策略要求）。
5. ExternalAgent phase 授权必须同时满足 `actions` 与 `scopes.ops`，`actions` 不得绕过 phase-op 控制。
6. ExternalAgent 的 `audits/events` 默认仅 token principal 自身可见；不得跨 principal 读取。
7. 写操作 `commit` 必须持久化 execution ledger 状态序列：`accepted -> executing -> committed|failed|replayed`。
8. 持久化出现不确定性时必须 fail-close，不得返回 silent success；同 `idempotencyKey` 后续重试不得重复触发副作用。
9. 执行等级矩阵：
   - `full`：必须支持 dry-run；commit 后必须可验证。
   - `guarded`：允许 preflight 代替真实 dry-run；必须返回风险提示并强审计。
   - `opaque`：允许执行但必须持久审计；不支持 dry-run；`high risk` 禁止。

### 4.6 统一返回与 ReasonCode

Hook Action 返回 envelope 最小字段：

1. `ok`
2. `reasonCode`
3. `actionHint`
4. `executionId`
5. `traceId`
6. `auditId`
7. `output?`

Hook Action 请求上下文最小字段：

1. `principalId`
2. `principalType`
3. `subjectAccountId`
4. `mode`（`delegated|autonomous`）
5. `delegationChain?`
6. `traceId`

V1 最小 reasonCode 集合：

1. `ACTION_EXECUTED`
2. `ACTION_DRY_RUN_UNSUPPORTED`
3. `ACTION_OPAQUE_HIGH_RISK_FORBIDDEN`
4. `ACTION_PERMISSION_DENIED`
5. `ACTION_IDEMPOTENCY_KEY_CONFLICT`
6. `SOCIAL_PRECONDITION_FAILED`
7. `SUBJECT_ACCOUNT_MISMATCH`

### 4.7 与 Local AI Runtime 的约束

1. `route source` 固定 `local-runtime | token-api`。
2. 回退必须显式可见（UI/日志）并记录 `fallback_to_token_api`。
3. 本地隐私语义仅在 `local-runtime` 路由下成立，不得误导为全局恒真。

### 4.8 协议字段与代码入口映射（V1）

1. `HookActionDescriptor.executionMode/riskLevel/operation/socialPrecondition`  
代码入口：`apps/desktop/src/runtime/hook/contracts/action.ts`、`apps/desktop/src/runtime/hook/services/action-service.ts`、`sdk/packages/mod-sdk/src/types/runtime-hook/action.ts`
2. `HookActionRequestContext.principalId/principalType/subjectAccountId/mode/issuer/authTokenId`  
代码入口：`apps/desktop/src-tauri/src/external_agent_gateway/server.rs`（网关注入）与 `apps/desktop/src/runtime/hook/services/action-service.ts`（校验）；`external_agent_verify_execution_context` 负责网关侧 token+execution ownership（principal+token）绑定校验。
3. `HookActionResult.reasonCode/actionHint/executionId/traceId/auditId`  
代码入口：`apps/desktop/src/runtime/hook/services/action-service.ts`、`apps/desktop/src/runtime/hook/audit/action-audit-sink.ts`
4. `discover -> dry-run -> verify -> commit -> audit`  
代码入口：`apps/desktop/src/runtime/hook/contracts/facade.ts`、`apps/desktop/src/runtime/external-agent/index.ts`
5. `ExternalAgent token issue/revoke/list + revocation persistence`  
代码入口：`apps/desktop/src-tauri/src/external_agent_gateway/token_issuer.rs`、`apps/desktop/src-tauri/src/external_agent_gateway/auth.rs`、`apps/desktop/src-tauri/src/runtime_mod/store.rs`
6. `Human internal action executor`（与 ExternalAgent 共享同一 Action 协议栈）  
代码入口：`apps/desktop/src/runtime/hook/action-human-executor.ts`
7. `Action execution ledger durable lifecycle`  
代码入口：`apps/desktop/src-tauri/src/runtime_mod/store.rs`、`apps/desktop/src-tauri/src/runtime_mod/commands.rs`、`apps/desktop/src/runtime/runtime-store/tauri-bridge.ts`、`apps/desktop/src/runtime/hook/services/action-service.ts`

## 5. 性能与可用性红线

### 5.1 性能

1. 控制面与数据面必须分离，热路径只保留最小校验。
2. 策略与授权决策应本地缓存/预编译，避免每次远程判定。
3. 审计写入默认异步（不阻塞主链路），并保留可靠落盘路径。

建议预算（默认目标）：

1. Action 控制面附加开销 `p95 <= 20ms`（仅本地路径控制面附加开销，不包含模型推理时间与 token-api 网络时延）。
2. 不因审计写入阻塞核心执行成功路径。

### 5.2 可用性

1. 只读低风险动作在策略服务异常时可降级（受控 fail-open）。
2. 高风险写动作在策略服务异常时默认 fail-close。
3. 所有降级路径必须有可观测事件与用户可见提示。

## 6. 实施清单（V1 强制）

1. 将“人类操作”收敛为可注册 Action，而非散落 UI 行为。`[Mod/Hook 域]`
2. 所有写操作补齐 `dry-run + reasonCode + idempotencyKey`。`[各业务域]`
3. Hook 权限升级到 Action 粒度（不止模块粒度）。`[Mod 域]`
4. 强制执行回退可见化与审计闭环。`[Local AI Runtime 域]`
5. 统一 Principal 身份与签名验证链路。`[本域 + Agent 域]`
6. 为外部 Agent 接入保留 discover/authorize/verify/commit/audit 五段桥接接口。`[本域]`

## 7. 非目标（当前版本）

1. 不在本版本内实现全量跨设备自动编排平台。
2. 不以 UI 自动化脚本作为 AI 主执行路径。
3. 不引入绕过 Hook 的直连内部服务捷径。
4. 不在 V1 提供“External runtime 以 NimiAgent 身份接入”的 `AgentToken` 模式（仅保留为 Vision 讨论项）。
5. 不在 V1 预设 autonomous 模式的账户类型与注册机制；仅锁定接入协议结构与校验链，账户模型留待 V2 定义。

## 8. 与其他 SSOT 的关系

1. `ai-last-mile.md` 定义跨域总语义，不替代单域 SSOT。
2. `local-ai-runtime.md` 负责能力基建语义；`mod.md` 负责接入边界语义。
3. `boundaries/world.md + boundaries/agent.md` 共同承载关系连续性语义。
4. `@nimiplatform/nimi-mods/local-chat/SSOT.md` 是关系连续性在会话执行层的直接落地（用户与 Agent 的持续交互主路径）。
5. 若出现跨域冲突，先回到域边界裁决，再更新本文件保持一致。
