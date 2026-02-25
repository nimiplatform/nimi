---
title: Nimi Desktop Runtime Contract SSOT
status: ACTIVE
version: v3.1
updated_at: 2026-02-25
rules:
  - execution-plane 固定在 desktop；control-plane 固定在 nimi-realm，且为可选依赖。
  - 第三方 Mod 默认在本地执行，不以 nimi-realm 可用性为前置条件。
  - 固定治理链 8 环节不可裁剪：discovery → manifest/compat → signature/auth → dependency/build → sandbox/policy → load → lifecycle → audit。
  - 各治理环节必须输出结构化决策记录，任何 DENY 阻断后续。
  - 本地审计不可关闭；上报 nimi-realm 为可配置能力。
  - nimi-realm 不承载第三方 Mod 默认执行宿主职责。
  - nimi-realm core-turn-service 保持纯 Core，不接 Runtime Mod/Hook 执行链。
  - Desktop 路由边界只定义 PRIVATE/CLOUD 职责；Agent Chat 执行规范引用 `@nimiplatform/nimi-mods/local-chat/SSOT.md`。
  - llm-adapter 固定在 Desktop，不在非 Desktop 端重复实现；本地 AI 基建细节统一引用 `ssot/runtime/local-runtime.md`。
  - Local AI Runtime 依赖抽象固定为 `model -> service -> node`；生命周期写权限固定 Core 独占。
  - 无审计事件的生命周期或执行动作被禁止。
  - Control-plane 不可用时，不得阻断 local-only 执行。
  - 平台不承担 LLM 调用成本；算力由用户通过 LLM-Adapter 自行配置（本地模型或自有 API Key）。
---

# Nimi Desktop Runtime Contract 唯一真相（SSOT）

## 1. 目标与边界

Desktop Runtime 域目标：

1. 定义 Runtime 双平面架构的职责划分与执行边界。
2. 定义 Execution-Kernel、Hook、LLM-Adapter 三大支柱的语义。
3. 定义 Core-Turn 与 Runtime 的边界，防止互相污染。
4. 定义会话路由（PRIVATE vs CLOUD）的决策规则。

Desktop Runtime 域边界：

1. Desktop Runtime 域定义：双平面、三大支柱、治理链、会话路由、语义对象、审计要求。
2. Desktop Runtime 域不拥有：Mod 生态治理细节（Mod 域）、经济账本（Economy 域）、社交关系（Social 域）。
3. Runtime 变更必须先声明影响平面（execution / control / 两者）。

## 2. 核心概念

### 2.1 Runtime 双平面

| 平面 | Owner | 性质 | 职责 |
|------|-------|------|------|
| `execution-plane` | `desktop` | 强制 | Mod 加载、沙箱执行、Hook 调度、本地 AI Runtime、重度世界模拟 |
| `control-plane` | `nimi-realm` | 可选 | 来源/签名校验、撤销列表、风险情报、grant token、审计汇聚 |

第三方 Mod 默认在本地执行，不以 nimi-realm 可用性为前置条件。

### 2.2 Execution-Kernel

Desktop Mod Launcher，执行固定治理链。

`CrashIsolator` 作为横切子系统确保单 Mod 故障不影响 Core。`CrashIsolator` 不单独计入 8 个治理环节。

固定治理链（8 环节）：

```
discovery → manifest/compat → signature/auth → dependency/build → sandbox/policy → load → lifecycle → audit
```

各环节职责：

| 环节 | 职责 | 输出 | 失败行为 |
|------|------|------|---------|
| `discovery` | 发现本地/远程 Mod 包 | Mod 候选列表 | 无候选则终止 |
| `manifest/compat` | 解析 ModManifest，检查 runtime 版本兼容性 | 兼容性决策 | DENY → 阻断 |
| `signature/auth` | 签名校验，来源认证 | 签名决策 | official/community: DENY → 阻断; sideload/local-dev: WARN → 可继续 |
| `dependency/build` | 依赖解析，版本冲突检查 | 依赖图谱 | 冲突 → DENY → 阻断 |
| `sandbox/policy` | 沙箱约束配置，权限策略应用 | 沙箱配置 | 超限 → DENY → 阻断 |
| `load` | 加载 Mod 到 isolate | 加载凭证 | 加载失败 → CrashIsolator 隔离 |
| `lifecycle` | 生命周期钩子执行 | 生命周期事件 | 异常 → CrashIsolator 隔离 |
| `audit` | 本地审计事件写入 | 审计记录 | 不可关闭 |

### 2.3 Hook（Core API 开放层）

5 类子系统：

| Hook 类型 | 语义 | 说明 |
|----------|------|------|
| `event-bus` | 事件订阅/发布 | Mod 可订阅 Core 事件（如会话创建、消息发送） |
| `data-api` | Core 数据读写能力 | 受权限控制，走认证上下文 |
| `ui-extension` | UI 扩展注入 | Mod 可在指定扩展点注入自定义 UI |
| `turn-hook` | 回合扩展点 | `pre-policy / pre-model / post-state / pre-commit` |
| `inter-mod` | Mod 间通信 | Mod 之间的消息传递通道 |

Hook Service 缓存：Hook service 为 Mod 请求的 agent/world 数据提供缓存层。缓存数据包括 agent identity、world 配置等变化频率不大但会变化的数据。缓存策略由 hook 层管理，便于未来调整。

### 2.4 LLM-Adapter（共享算力层）

固定在 Desktop 的共享算力层：

| 组件 | 职责 | 说明 |
|------|------|------|
| `local-ai-runtime-supervisor` | 本地引擎与模型总控 | 统一管理引擎实例、模型生命周期、健康检查与崩溃恢复 |
| `model-registry` | 本地模型注册与能力索引 | 维护 modelId/engine/capabilities/source/hashes 等元数据 |
| `provider-adapters` | 云端 Provider 适配 | OpenAI, Claude, Gemini 等 |
| `capability-router` | 能力 → 模型/Provider 路由 | 按能力需求选择最优模型 |
| `credential-vault` | 用户 API Key 管理 | 非明文存储，加密保护；用户自配 API Key 是使用 LLM 的前提条件 |
| `usage-tracking` | 调用计量与成本可见性 | 跟踪各 Mod 的 LLM 使用量，帮助用户了解自身算力消耗 |

Local-first：优先本地 Provider/模型，cloud 为可选。

不在非 Desktop 端重复实现 `llm-adapter` runtime。
本地 AI 基建（四层抽象、模型/服务供应链、依赖编排、路由来源/能力维度、审计策略）以 `ssot/runtime/local-runtime.md` 为唯一真相。

### 2.5 Core-Turn-Service

nimi-realm 侧回合执行服务：`context → policy → model/tool → state → trace/audit`。

保持纯 Core，不接 Runtime Mod/Hook 执行链。

## 3. 全局硬约束（MUST）

1. `execution-plane` 固定在 `desktop`。
2. `control-plane` 固定在 `nimi-realm`，且为可选依赖。
3. 固定治理链 8 环节不可裁剪。
4. 各治理环节必须输出结构化决策记录，任何 `DENY` 阻断后续。
5. 本地审计不可关闭；上报 nimi-realm 为可配置能力。
6. nimi-realm 不承载第三方 Mod 默认执行宿主职责。
7. nimi-realm `core-turn-service` 保持纯 Core，不接 Runtime Mod/Hook 执行链。
8. Desktop PRIVATE 路由走本地 `execution-kernel`。
9. CLOUD 路由走 nimi-realm `core-turn-service`。
10. `llm-adapter` 固定在 Desktop，不在非 Desktop 端重复实现。
11. 无审计事件的生命周期或执行动作被禁止。
12. Control-plane 不可用时，不得阻断 local-only 执行。
13. 平台不承担 LLM 调用成本；算力由用户通过 `LLM-Adapter` 自行配置。
14. AI 路由来源语义固定为 `local-runtime/token-api`，能力维度固定为 `chat/image/video/tts/stt/embedding`（详见 `ssot/runtime/local-runtime.md`）。
15. Local AI Runtime 生命周期写权限固定 Core 独占，业务 Mod 仅可声明依赖与消费能力。

## 4. 会话路由

| 路由 | 执行位置 | 使用场景 | 说明 |
|------|---------|---------|------|
| `PRIVATE` | Desktop 本地 | User ↔ Friend Agent（所有 Agent 聊天） | 执行规范见 `@nimiplatform/nimi-mods/local-chat/SSOT.md` |
| `CLOUD` | nimi-realm | User ↔ Human 好友/联系人 | 走 core-turn-service，纯消息无 LLM |

V1 Agent Chat 通过 Desktop PRIVATE 路由；具体执行与会话规则见 `@nimiplatform/nimi-mods/local-chat/SSOT.md`。Web 端 Agent Chat 待 Nimi cloud LLM subscription 上线后开放。
`Sessions` 入口位置、会话范围与删除重建策略均以 `@nimiplatform/nimi-mods/local-chat/SSOT.md` 为唯一定义。

PRIVATE 路由是 Mod 扩展的主要通道。
CLOUD 路由保持 Core 纯粹性。

## 5. 语义对象

### 5.1 Core-Turn 语义对象

| 对象 | 语义 | 使用位置 |
|------|------|---------|
| `RuntimeContext` | 回合上下文输入集合（world + agent + memory + social + economy） | Core-Turn 入口 |
| `PolicyDecision` | 回合策略裁决结果 | policy 阶段输出 |
| `ToolOrModelCall` | 模型/工具执行请求与响应 | model/tool 阶段 |
| `StateTransition` | 回合状态推进结果 | state 阶段输出 |
| `PromptTrace` | 回合可解释证据 | trace 阶段输出 |
| `AuditEvent` | 回合审计事件 | audit 阶段输出 |

### 5.2 Execution-Kernel 语义对象

| 对象 | 语义 | 使用位置 |
|------|------|---------|
| `ModManifest` | Mod 元数据、兼容性、权限、依赖、入口声明 | manifest/compat 环节 |
| `ModSignature` | Mod 包来源与完整性证明 | signature/auth 环节 |
| `DependencyGraph` | Mod 依赖与版本冲突解析结果 | dependency/build 环节 |
| `SandboxProfile` | Mod 沙箱执行约束 | sandbox/policy 环节 |
| `PermissionGrant` | Mod 能力授权结论 | sandbox/policy 环节 |
| `ComplianceDecision` | 合规与安全审查结论 | signature/auth 环节 |
| `LoadTicket` | 加载凭证 | load 环节 |
| `ExtensionAuditEvent` | 生命周期审计事件 | lifecycle + audit 环节 |

## 6. nimi-realm 边界

### 6.1 Apps（进程级边界）

- Core Apps: `api`, `brain`, `realtime`
- Platform-Ops Apps: `indexer`, `scheduler`, `worker`
- `indexer` 是独立 app，不是 API module。

### 6.2 API Modules（apps/api/src/modules）

- Core Modules: `auth`, `user`, `agent`, `world`, `chat`, `creator`, `relationship`, `visibility`, `economy`, `search`, `discover`, `explore`, `translation`, `human`, `media`, `notification`, `post`
- Core-Adjacent Modules: `agent-surface`, `creator-surface`, `world-surface`, `invitation`, `desktop`, `discovery-engine`
- Platform-Ops Modules: `@admin`, `governance`, `support`, `referral`, `asset`

### 6.3 Domains（nimi-realm domain boundary）

- Core/Core-Adjacent: `user`, `agent`, `world`, `world-context`, `chat`, `relationship`, `social`, `economy`, `desktop`, `translation`, `discovery-engine`, `content`, `notification`, `access-control`, `tier`
- Platform-Ops: `asset`, `governance`, `referral`, `support`

### 6.4 Runtime-Control（可选治理服务）

1. Manifest/Signature 校验 API。
2. 信任情报与撤销列表分发（revocation/risk feed）。
3. 平台受保护能力授权令牌（grant token）。
4. 审计汇聚与风控联动。

### 6.5 Runtime-Execution（Desktop Owner）

1. Mod 安装、加载、启用、禁用、卸载、升级、执行。
2. Hook 注册与调用编排。
3. 沙箱与配额执行。
4. 重型世界模拟与本地玩法执行。

### 6.6 Platform-Ops 总则

`platform-ops` 不是 `mod`，也不等于可删；是否保留由业务与运维策略决定。

## 7. 禁止事项

1. 在 nimi-realm 恢复第三方 Mod 默认执行宿主职责。
2. 绕过 Hook 直接开放 Core 数据平面给 Mod。
3. 在非 Desktop 端重复实现 `llm-adapter` runtime。
4. 无审计事件的生命周期或执行动作。
5. 对 `nimi-realm` 的 Core/Core-Adjacent 做功能删减式瘦身。

## 8. 非目标（当前版本）

1. 不做多人协同编辑与冲突自动合并。
2. 不在 nimi-realm 新增 world-studio 私有编排接口。
3. 不让 Mod 的模型覆盖直接写入全局 runtime 路由配置。

## 9. 面向开发的落地准则

1. Desktop Runtime 变更必须先声明影响平面（execution / control / 两者）。
2. 新增 Hook 类型必须先定义语义对象。
3. LLM-Adapter 新增 Provider 必须遵循 `capability-router` 统一路由。
4. Core-Turn-Service 变更不得引入 Mod/Hook 执行链依赖。
5. 任何跨平面调用必须走定义好的 grant token 或 Hook 协议。
6. 涉及模型来源、导入校验、AI 路由来源与能力维度的变更，必须先更新 `ssot/runtime/local-runtime.md` 再改代码。

## 10. 验收标准

一个 Desktop Runtime 相关功能只有满足以下条件才可视为完成：

1. 执行平面归属正确（Desktop 或 nimi-realm）。
2. 治理链完整通过。
3. 审计事件记录完整。
4. local-only 场景无 nimi-realm 硬依赖。
5. Core-Turn 与 Runtime 边界未被污染。

## 11. 兼容与演进原则

1. SSOT 变更优先更新本文件，再改代码。
2. 治理链变更属于破坏性变更，需迁移计划。
3. 新增 Runtime 能力优先扩展通用 API 与 Hook capability，不新增私有协议。
4. 任何偏离以上规则的实现视为回归，必须阻断进入主分支。
