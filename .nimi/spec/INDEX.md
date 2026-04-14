# Spec Index

## Runtime（当前）

Runtime 规范采用 kernel + domain 的两层结构，覆盖 Runtime proto 全量服务。

- Kernel（唯一事实源）：`.nimi/spec/runtime/kernel/`
- Domain（薄文档导引层）：
  - `.nimi/spec/runtime/cli.md`
  - `.nimi/spec/runtime/connector.md`
  - `.nimi/spec/runtime/nimillm.md`
  - `.nimi/spec/runtime/local-model.md`
  - `.nimi/spec/runtime/config.md`
  - `.nimi/spec/runtime/multimodal-provider.md`
  - `.nimi/spec/runtime/multimodal-delivery-gates.md`
  - `.nimi/spec/runtime/proto-governance.md`
- Phase 2 Draft（已有 kernel 契约，尚无独立 domain 文档）：
  - `RuntimeWorkflowService`（`K-WF-*`）
  - `RuntimeModelService`（`K-MODEL-*`）
  - `RuntimeKnowledgeService`（`K-KNOW-*`）
  - `RuntimeAppService`（`K-APP-*`）
  - `RuntimeAuditService`（`K-AUDIT-*`，审计核心字段与 Phase 1 共享部分为 Normative）

## Task-Oriented 最短阅读路径

### 修改 Connector 鉴权 / owner / key-source

1. `.nimi/spec/runtime/kernel/authz-ownership.md`
2. `.nimi/spec/runtime/kernel/authn-token-validation.md`
3. `.nimi/spec/runtime/kernel/auth-service.md`
4. `.nimi/spec/runtime/kernel/grant-service.md`
5. `.nimi/spec/runtime/kernel/key-source-routing.md`
6. `.nimi/spec/runtime/connector.md`

### 修改 AI Profile Runtime Execution / Probe / Snapshot

1. `.nimi/spec/runtime/kernel/ai-profile-execution-contract.md`（K-AIEXEC-001 ~ K-AIEXEC-005）
2. `.nimi/spec/runtime/kernel/scheduling-contract.md`（K-SCHED-001 ~ K-SCHED-007, atomic target / aggregate preflight）
3. `.nimi/spec/runtime/kernel/local-category-capability.md`（K-LOCAL-013 ~ K-LOCAL-015, K-LOCAL-014a）
4. `.nimi/spec/runtime/kernel/device-profile-contract.md`（K-DEV-001 ~ K-DEV-009）
5. `.nimi/spec/desktop/kernel/ai-profile-config-contract.md`（D-AIPC-004, D-AIPC-012）
6. `.nimi/spec/sdk/kernel/ai-config-surface-contract.md`（S-AICONF-001 ~ S-AICONF-002）

### 修改 CLI 首次使用 / 安装路径 / provider-first cloud setup

1. `.nimi/spec/runtime/kernel/cli-onboarding-contract.md`
2. `.nimi/spec/runtime/kernel/daemon-lifecycle.md`
3. `.nimi/spec/runtime/kernel/model-service-contract.md`
4. `.nimi/spec/runtime/kernel/provider-health-contract.md`
5. `.nimi/spec/runtime/config.md`
6. `.nimi/spec/runtime/cli.md`

### 修改 remote 执行行为（nimillm）

1. `.nimi/spec/runtime/kernel/rpc-surface.md`
2. `.nimi/spec/runtime/kernel/streaming-contract.md`
3. `.nimi/spec/runtime/kernel/error-model.md`
4. `.nimi/spec/runtime/nimillm.md`

### 修改 local 执行行为

1. `.nimi/spec/runtime/kernel/local-category-capability.md`
2. `.nimi/spec/runtime/kernel/local-engine-contract.md`
3. `.nimi/spec/runtime/kernel/device-profile-contract.md`
4. `.nimi/spec/runtime/kernel/streaming-contract.md`
5. `.nimi/spec/runtime/local-model.md`

### 修改本地引擎（llama / media / sidecar）

1. `.nimi/spec/runtime/kernel/local-engine-contract.md`
2. `.nimi/spec/runtime/kernel/tables/local-engine-catalog.yaml`
3. `.nimi/spec/runtime/local-model.md`

### 修改本地适配器路由

1. `.nimi/spec/runtime/kernel/local-category-capability.md`（K-LOCAL-017）
2. `.nimi/spec/runtime/kernel/tables/local-adapter-routing.yaml`
3. `.nimi/spec/runtime/local-model.md`

### 修改设备画像检测

1. `.nimi/spec/runtime/kernel/device-profile-contract.md`
2. `.nimi/spec/runtime/local-model.md`

### 修改依赖解析 / Apply 管道

1. `.nimi/spec/runtime/kernel/local-category-capability.md`（K-LOCAL-013~015）
2. `.nimi/spec/runtime/local-model.md`

### 修改错误码

1. `.nimi/spec/runtime/kernel/tables/reason-codes.yaml`
2. `.nimi/spec/runtime/kernel/error-model.md`
3. 受影响 domain 文档（只更新引用，不复制定义）

### 修改 provider 值域 / 入口能力 / endpoint 约束

1. `.nimi/spec/runtime/kernel/tables/provider-catalog.yaml`
2. `.nimi/spec/runtime/kernel/tables/provider-capabilities.yaml`
3. 受影响 domain 文档（`connector.md` / `nimillm.md` / `local-model.md`）

### 修改状态机与迁移

1. `.nimi/spec/runtime/kernel/tables/job-states.yaml`
2. `.nimi/spec/runtime/kernel/tables/state-transitions.yaml`
3. 受影响 kernel/domain 文档（按 Rule ID 引用）

### 修改 Memory Substrate / Canonical Review / Canonical Bank 边界

1. `.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`（`K-MEM-001 ~ K-MEM-012`，优先看 `K-MEM-004`, `K-MEM-010`, `K-MEM-011`, `K-MEM-012`）
2. `.nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md`（`K-MEMSUB-001 ~ K-MEMSUB-008`）
3. `.nimi/spec/runtime/kernel/runtime-agent-core-contract.md`（`K-AGCORE-004`, `K-AGCORE-015 ~ K-AGCORE-019`）
4. `.nimi/spec/runtime/kernel/tables/runtime-memory-bank-scope.yaml`
5. `.nimi/spec/runtime/kernel/tables/runtime-memory-replication-outcome.yaml`
6. `.nimi/spec/runtime/kernel/index.md`（核对 Runtime Phase 2 Draft 面与契约入口）

## Desktop（当前）

Desktop 规范采用 kernel + domain 的两层结构：

- Kernel（唯一事实源）：`.nimi/spec/desktop/kernel/`
- Domain：
  - `.nimi/spec/desktop/chat.md`
  - `.nimi/spec/desktop/contacts.md`
  - `.nimi/spec/desktop/profile.md`
  - `.nimi/spec/desktop/economy.md`
  - `.nimi/spec/desktop/explore.md`
  - `.nimi/spec/desktop/mod-codegen.md`
  - `.nimi/spec/desktop/runtime-config.md`
  - `.nimi/spec/desktop/settings.md`
  - `.nimi/spec/desktop/mod-hub.md`
  - `.nimi/spec/desktop/mod-workspace.md`
  - `.nimi/spec/desktop/external-agent.md`
  - `.nimi/spec/desktop/local-ai.md`
  - `.nimi/spec/desktop/web-adapter.md`
  - `.nimi/spec/desktop/home.md`
  - `.nimi/spec/desktop/notification.md`
  - `.nimi/spec/desktop/auth.md`
  - `.nimi/spec/desktop/agent-detail.md`
  - `.nimi/spec/desktop/world-detail.md`
  - `.nimi/spec/desktop/legal.md`
  - `.nimi/spec/desktop/testing-gates.md`
  - `.nimi/spec/desktop/mods-panel.md`
  - `.nimi/spec/desktop/mod-development.md`

### 修改 AI Profile / Config / Snapshot

1. `.nimi/spec/desktop/kernel/ai-profile-config-contract.md`（D-AIPC-001 ~ D-AIPC-012）
2. `.nimi/spec/desktop/kernel/conversation-capability-contract.md`（D-LLM-015 ~ D-LLM-021，submodel）
3. `.nimi/spec/platform/kernel/ai-scope-contract.md`（P-AISC-001 ~ P-AISC-005，AIScopeRef）
4. `.nimi/spec/desktop/kernel/llm-adapter-contract.md`（D-LLM-001 ~ D-LLM-014，provider / routing）

### 修改启动序列 / feature flag

1. `.nimi/spec/desktop/kernel/bootstrap-contract.md`
2. `.nimi/spec/desktop/kernel/tables/bootstrap-phases.yaml`
3. `.nimi/spec/desktop/kernel/tables/feature-flags.yaml`

### 修改 IPC 桥接命令

1. `.nimi/spec/desktop/kernel/bridge-ipc-contract.md`
2. `.nimi/spec/desktop/kernel/tables/ipc-commands.yaml`

### 修改 Hook 能力模型

1. `.nimi/spec/desktop/kernel/hook-capability-contract.md`
2. `.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml`
3. `.nimi/spec/desktop/kernel/tables/ui-slots.yaml`
4. `.nimi/spec/desktop/kernel/tables/turn-hook-points.yaml`

### 修改 Mod 治理

1. `.nimi/spec/desktop/kernel/mod-governance-contract.md`
2. `.nimi/spec/desktop/kernel/tables/mod-kernel-stages.yaml`
3. `.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml`
4. `.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml`

### 修改导航 / UI Shell

1. `.nimi/spec/desktop/kernel/ui-shell-contract.md`
2. `.nimi/spec/desktop/kernel/tables/app-tabs.yaml`
3. `.nimi/spec/desktop/kernel/tables/build-chunks.yaml`

### 修改错误码

1. `.nimi/spec/desktop/kernel/tables/error-codes.yaml`
2. `.nimi/spec/desktop/kernel/error-boundary-contract.md`
3. 受影响 domain 文档（只更新引用，不复制定义）

### 修改网络重试策略

1. `.nimi/spec/desktop/kernel/network-contract.md`
2. `.nimi/spec/desktop/kernel/tables/retry-status-codes.yaml`

### 修改多模态 UI 交付（图片/视频/音频/TTS/STT）

1. `.nimi/spec/desktop/chat.md`（文本+语音渲染）
2. `.nimi/spec/desktop/kernel/streaming-consumption-contract.md`（D-STRM-005 ScenarioJob 事件流）
3. `.nimi/spec/desktop/local-ai.md`（D-LLM-005 语音引擎集成）
4. `.nimi/spec/runtime/multimodal-provider.md`（上游多模态提供者）
5. `.nimi/spec/runtime/multimodal-delivery-gates.md`（上游交付门控）

### 修改 Knowledge-Base Mod

1. mods 仓库中的 knowledge-base SSOT
2. `.nimi/spec/runtime/kernel/knowledge-contract.md`（K-KNOW-*）
3. `.nimi/spec/desktop/kernel/hook-capability-contract.md`（D-HOOK-*）
4. mods 仓库中的 `AGENTS.md`

## 约束

- 规则必须先改 kernel，再改 domain。
- domain 文档禁止复述 kernel 规则正文。
- domain 文档禁止定义本地规则 ID 体系（仅引用 `K/S/D/P/R/F-*`）。
- 执行态计划、冻结包与结果不得写入 `/.nimi/spec/**`；human-authored topic lifecycle reports 写入 `.nimi/local/report/{proposal|ongoing|closed}/<topic-id>/**`；legacy execution evidence may still appear under `.local/report/**` as compatibility/local-only operational output；tracked spec 不依赖具体 local 文件。
- domain 文档应保持薄层结构：定位、映射、阅读路径、非目标。

## SDK（当前）

SDK 规范采用 kernel + domain 的两层结构：

- Kernel（唯一事实源）：`.nimi/spec/sdk/kernel/`
- Domain：
  - `.nimi/spec/sdk/runtime.md`
  - `.nimi/spec/sdk/ai-provider.md`
  - `.nimi/spec/sdk/realm.md`
  - `.nimi/spec/sdk/scope.md`
  - `.nimi/spec/sdk/mod.md`
  - `.nimi/spec/sdk/types.md`
  - `.nimi/spec/sdk/testing-gates.md`

### 修改 SDK AI Config / Profile / Snapshot Surface

1. `.nimi/spec/sdk/kernel/ai-config-surface-contract.md`（S-AICONF-001 ~ S-AICONF-006）
2. `.nimi/spec/desktop/kernel/ai-profile-config-contract.md`（D-AIPC-001 ~ D-AIPC-012，canonical model）
3. `.nimi/spec/platform/kernel/ai-scope-contract.md`（P-AISC-001 ~ P-AISC-005，AIScopeRef）
4. `.nimi/spec/sdk/kernel/runtime-route-contract.md`（S-RUNTIME-074 ~ S-RUNTIME-078，route probe 依赖）

### 修改 SDK 跨域规则

1. `.nimi/spec/sdk/kernel/surface-contract.md`
2. `.nimi/spec/sdk/kernel/transport-contract.md`
3. `.nimi/spec/sdk/kernel/error-projection.md`
4. `.nimi/spec/sdk/kernel/boundary-contract.md`

### 修改 SDK 子路径文档

1. 先改 `.nimi/spec/sdk/kernel/*`（必要时含 `tables/*`）
2. 再改对应 `.nimi/spec/sdk/*.md` domain 文档

## Platform（当前）

Platform 规范采用 kernel + domain 的两层结构，覆盖平台架构、协议、AI 最后一公里、开源治理。

- Kernel（唯一事实源）：`.nimi/spec/platform/kernel/`
- Tables（事实源）：`.nimi/spec/platform/kernel/tables/`
- Generated（自动生成视图）：`.nimi/spec/platform/kernel/generated/`
- Domain：
  - `.nimi/spec/platform/vision.md`
  - `.nimi/spec/platform/architecture.md`
  - `.nimi/spec/platform/protocol.md`
  - `.nimi/spec/platform/design-pattern.md`
  - `.nimi/spec/platform/ai-last-mile.md`
  - `.nimi/spec/platform/ai-agent-security-interface.md`
  - `.nimi/spec/platform/open-source-governance.md`

### 修改 AI 配置作用域 / AIScopeRef

1. `.nimi/spec/platform/kernel/ai-scope-contract.md`（P-AISC-001 ~ P-AISC-005）
2. `.nimi/spec/desktop/kernel/ai-profile-config-contract.md`（D-AIPC-001 ~ D-AIPC-012，AIScopeRef 消费端）
3. `.nimi/spec/platform/architecture.md`

### 修改协议层 / 版本协商 / 原语

1. `.nimi/spec/platform/kernel/protocol-contract.md`
2. `.nimi/spec/platform/kernel/tables/protocol-error-codes.yaml`
3. `.nimi/spec/platform/kernel/tables/protocol-primitives.yaml`
4. `.nimi/spec/platform/protocol.md`

### 修改架构层 / 通信模式 / 凭证面

1. `.nimi/spec/platform/kernel/architecture-contract.md`
2. `.nimi/spec/platform/architecture.md`

### 修改设计模式 / 共享 UI 语义

1. `.nimi/spec/platform/kernel/design-pattern-contract.md`
2. `.nimi/spec/platform/kernel/tables/nimi-ui-tokens.yaml`
3. `.nimi/spec/platform/kernel/tables/nimi-ui-primitives.yaml`
4. `.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml`
5. `.nimi/spec/platform/kernel/tables/nimi-ui-adoption.yaml`
6. `.nimi/spec/platform/kernel/tables/nimi-ui-compositions.yaml`
7. `.nimi/spec/platform/design-pattern.md`

### 修改 AI 最后一公里 / Hook Action Fabric

1. `.nimi/spec/platform/kernel/ai-last-mile-contract.md`
2. `.nimi/spec/platform/ai-last-mile.md`

### 修改开源治理 / License / 发布门

1. `.nimi/spec/platform/kernel/governance-contract.md`
2. `.nimi/spec/platform/open-source-governance.md`

### 修改合规测试 / 审计事件

1. `.nimi/spec/platform/kernel/tables/compliance-test-matrix.yaml`
2. `.nimi/spec/platform/kernel/tables/audit-events.yaml`
3. `.nimi/spec/platform/protocol.md`

### 修改应用授权 / 参与者画像

1. `.nimi/spec/platform/kernel/tables/app-authorization-presets.yaml`
2. `.nimi/spec/platform/kernel/tables/participant-profiles.yaml`
3. `.nimi/spec/platform/protocol.md`

## Realm（当前）

Realm 规范采用 kernel + domain 的两层结构，覆盖 Realm Truth、World State、World History、Agent Memory、human-only chat、creator asset、创作者经济与 transit。

- Kernel（唯一事实源）：`.nimi/spec/realm/kernel/`
- Tables（事实源）：`.nimi/spec/realm/kernel/tables/`
- Generated（自动生成视图）：`.nimi/spec/realm/kernel/generated/`
- Domain：
  - `.nimi/spec/realm/truth.md`
  - `.nimi/spec/realm/world-state.md`
  - `.nimi/spec/realm/world-history.md`
  - `.nimi/spec/realm/agent-memory.md`
  - `.nimi/spec/realm/world.md`
  - `.nimi/spec/realm/agent.md`
  - `.nimi/spec/realm/chat.md`
  - `.nimi/spec/realm/social.md`
  - `.nimi/spec/realm/economy.md`
  - `.nimi/spec/realm/asset.md`
  - `.nimi/spec/realm/transit.md`
  - `.nimi/spec/realm/world-creator-economy.md`
  - `.nimi/spec/realm/creator-revenue-policy.md`
  - `.nimi/spec/realm/app-interconnect-model.md`
  - `.nimi/spec/realm/realm-interop-mapping.md`

### 修改 Realm core contracts

1. `.nimi/spec/realm/kernel/truth-contract.md`
2. `.nimi/spec/realm/kernel/world-state-contract.md`
3. `.nimi/spec/realm/kernel/world-history-contract.md`
4. `.nimi/spec/realm/kernel/agent-memory-contract.md`
5. `.nimi/spec/realm/kernel/chat-contract.md`
6. `.nimi/spec/realm/kernel/social-contract.md`
7. `.nimi/spec/realm/kernel/transit-contract.md`
8. 受影响 domain 文档（`truth.md` / `world-state.md` / `world-history.md` / `agent-memory.md` / `world.md` / `agent.md` / `chat.md` / `social.md` / `transit.md`）

### 修改 realm creator asset / NovelAsset

1. `.nimi/spec/realm/kernel/asset-contract.md`
2. `.nimi/spec/realm/kernel/tables/asset-contract.yaml`
3. 受影响 domain 文档（`asset.md` / `app-interconnect-model.md`）

### 修改创作者经济 / 定价 / 收入

1. `.nimi/spec/realm/kernel/economy-contract.md`
2. `.nimi/spec/realm/kernel/tables/economy-contract.yaml`
3. `.nimi/spec/realm/world-creator-economy.md`
4. `.nimi/spec/realm/creator-revenue-policy.md`
5. 受影响 domain 文档（`economy.md` / `world-creator-economy.md` / `creator-revenue-policy.md`）

### 修改原语互操作映射

1. `.nimi/spec/realm/kernel/world-state-contract.md`
2. `.nimi/spec/realm/kernel/world-history-contract.md`
3. `.nimi/spec/realm/kernel/agent-memory-contract.md`
4. `.nimi/spec/realm/kernel/transit-contract.md`
5. `.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml`
6. `.nimi/spec/realm/realm-interop-mapping.md`

## Future Capabilities

未来能力 backlog，汇总研究报告中可借鉴项，按优先级分类管理：

- Kernel（治理规则）：`.nimi/spec/future/kernel/`
- Tables（事实源）：`.nimi/spec/future/kernel/tables/`
- Generated（自动生成视图）：`.nimi/spec/future/kernel/generated/`

### 添加新的未来能力条目

1. `.nimi/spec/future/kernel/source-registry.md` — 确认来源已注册
2. `.nimi/spec/future/kernel/capability-backlog.md` — 条目结构与生命周期
3. `.nimi/spec/future/kernel/tables/backlog-items.yaml` — 添加条目

### 毕业条目到正式 spec

1. `.nimi/spec/future/kernel/graduation-contract.md` — 毕业条件与流程
2. `.nimi/spec/future/kernel/tables/graduation-log.yaml` — 记录毕业日志
