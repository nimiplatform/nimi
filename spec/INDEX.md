# Spec Index

## Runtime（当前）

Runtime 规范采用 kernel + domain 的两层结构，覆盖 Runtime proto 全量服务。

- Kernel（唯一事实源）：`spec/runtime/kernel/`
- Domain（薄文档导引层）：
  - `spec/runtime/connector.md`
  - `spec/runtime/nimillm.md`
  - `spec/runtime/local-model.md`
  - `spec/runtime/config.md`
  - `spec/runtime/multimodal-provider.md`
  - `spec/runtime/multimodal-delivery-gates.md`
  - `spec/runtime/proto-governance.md`
- Phase 2 Draft（已有 kernel 契约，尚无独立 domain 文档）：
  - `RuntimeWorkflowService`（`K-WF-*`）
  - `RuntimeModelService`（`K-MODEL-*`）
  - `RuntimeKnowledgeService`（`K-KNOW-*`）
  - `RuntimeAppService`（`K-APP-*`）
  - `RuntimeAuditService`（`K-AUDIT-*`，审计核心字段与 Phase 1 共享部分为 Normative）

## Task-Oriented 最短阅读路径

### 修改 Connector 鉴权 / owner / key-source

1. `spec/runtime/kernel/authz-ownership.md`
2. `spec/runtime/kernel/authn-token-validation.md`
3. `spec/runtime/kernel/auth-service.md`
4. `spec/runtime/kernel/grant-service.md`
5. `spec/runtime/kernel/key-source-routing.md`
6. `spec/runtime/connector.md`

### 修改 remote 执行行为（nimillm）

1. `spec/runtime/kernel/rpc-surface.md`
2. `spec/runtime/kernel/streaming-contract.md`
3. `spec/runtime/kernel/error-model.md`
4. `spec/runtime/nimillm.md`

### 修改 local 执行行为

1. `spec/runtime/kernel/local-category-capability.md`
2. `spec/runtime/kernel/local-engine-contract.md`
3. `spec/runtime/kernel/device-profile-contract.md`
4. `spec/runtime/kernel/streaming-contract.md`
5. `spec/runtime/local-model.md`

### 修改本地引擎（LocalAI / Nexa）

1. `spec/runtime/kernel/local-engine-contract.md`
2. `spec/runtime/kernel/tables/local-engine-catalog.yaml`
3. `spec/runtime/local-model.md`

### 修改本地适配器路由

1. `spec/runtime/kernel/local-category-capability.md`（K-LOCAL-017）
2. `spec/runtime/kernel/tables/local-adapter-routing.yaml`
3. `spec/runtime/local-model.md`

### 修改设备画像检测

1. `spec/runtime/kernel/device-profile-contract.md`
2. `spec/runtime/local-model.md`

### 修改依赖解析 / Apply 管道

1. `spec/runtime/kernel/local-category-capability.md`（K-LOCAL-013~015）
2. `spec/runtime/local-model.md`

### 修改错误码

1. `spec/runtime/kernel/tables/reason-codes.yaml`
2. `spec/runtime/kernel/error-model.md`
3. 受影响 domain 文档（只更新引用，不复制定义）

### 修改 provider 值域 / 入口能力 / endpoint 约束

1. `spec/runtime/kernel/tables/provider-catalog.yaml`
2. `spec/runtime/kernel/tables/provider-capabilities.yaml`
3. 受影响 domain 文档（`connector.md` / `nimillm.md` / `local-model.md`）

### 修改状态机与迁移

1. `spec/runtime/kernel/tables/job-states.yaml`
2. `spec/runtime/kernel/tables/state-transitions.yaml`
3. 受影响 kernel/domain 文档（按 Rule ID 引用）

## Desktop（当前）

Desktop 规范采用 kernel + domain 的两层结构：

- Kernel（唯一事实源）：`spec/desktop/kernel/`
- Domain：
  - `spec/desktop/chat.md`
  - `spec/desktop/contacts.md`
  - `spec/desktop/profile.md`
  - `spec/desktop/economy.md`
  - `spec/desktop/explore.md`
  - `spec/desktop/mod-codegen.md`
  - `spec/desktop/runtime-config.md`
  - `spec/desktop/settings.md`
  - `spec/desktop/marketplace.md`
  - `spec/desktop/mod-workspace.md`
  - `spec/desktop/external-agent.md`
  - `spec/desktop/local-ai.md`
  - `spec/desktop/web-adapter.md`
  - `spec/desktop/home.md`
  - `spec/desktop/notification.md`
  - `spec/desktop/auth.md`
  - `spec/desktop/agent-detail.md`
  - `spec/desktop/world-detail.md`
  - `spec/desktop/legal.md`
  - `spec/desktop/testing-gates.md`
  - `spec/desktop/mods-panel.md`

### 修改启动序列 / feature flag

1. `spec/desktop/kernel/bootstrap-contract.md`
2. `spec/desktop/kernel/tables/bootstrap-phases.yaml`
3. `spec/desktop/kernel/tables/feature-flags.yaml`

### 修改 IPC 桥接命令

1. `spec/desktop/kernel/bridge-ipc-contract.md`
2. `spec/desktop/kernel/tables/ipc-commands.yaml`

### 修改 Hook 能力模型

1. `spec/desktop/kernel/hook-capability-contract.md`
2. `spec/desktop/kernel/tables/hook-capability-allowlists.yaml`
3. `spec/desktop/kernel/tables/ui-slots.yaml`
4. `spec/desktop/kernel/tables/turn-hook-points.yaml`

### 修改 Mod 治理

1. `spec/desktop/kernel/mod-governance-contract.md`
2. `spec/desktop/kernel/tables/mod-kernel-stages.yaml`
3. `spec/desktop/kernel/tables/mod-lifecycle-states.yaml`
4. `spec/desktop/kernel/tables/mod-access-modes.yaml`

### 修改导航 / UI Shell

1. `spec/desktop/kernel/ui-shell-contract.md`
2. `spec/desktop/kernel/tables/app-tabs.yaml`
3. `spec/desktop/kernel/tables/build-chunks.yaml`

### 修改错误码

1. `spec/desktop/kernel/tables/error-codes.yaml`
2. `spec/desktop/kernel/error-boundary-contract.md`
3. 受影响 domain 文档（只更新引用，不复制定义）

### 修改网络重试策略

1. `spec/desktop/kernel/network-contract.md`
2. `spec/desktop/kernel/tables/retry-status-codes.yaml`

### 修改多模态 UI 交付（图片/视频/音频/TTS/STT）

1. `spec/desktop/chat.md`（文本+语音渲染）
2. `spec/desktop/kernel/streaming-consumption-contract.md`（D-STRM-005 ScenarioJob 事件流）
3. `spec/desktop/local-ai.md`（D-LLM-005 语音引擎集成）
4. `spec/runtime/multimodal-provider.md`（上游多模态提供者）
5. `spec/runtime/multimodal-delivery-gates.md`（上游交付门控）

### 修改 Knowledge-Base Mod

1. `nimi-mods/knowledge-base/SSOT.md`
2. `spec/runtime/kernel/knowledge-contract.md`（K-KNOW-*）
3. `spec/desktop/kernel/hook-capability-contract.md`（D-HOOK-*）
4. `nimi-mods/AGENTS.md`

## 约束

- 规则必须先改 kernel，再改 domain。
- domain 文档禁止复述 kernel 规则正文。
- domain 文档禁止定义本地规则 ID 体系（仅引用 `K/S/D/P/R/F-*`）。
- 执行态计划与结果不得写入 `spec/**`，分别写入 `dev/plan/*` 与 `dev/report/*`。
- domain 文档应保持薄层结构：定位、映射、阅读路径、非目标。

## SDK（当前）

SDK 规范采用 kernel + domain 的两层结构：

- Kernel（唯一事实源）：`spec/sdk/kernel/`
- Domain：
  - `spec/sdk/runtime.md`
  - `spec/sdk/ai-provider.md`
  - `spec/sdk/realm.md`
  - `spec/sdk/scope.md`
  - `spec/sdk/mod.md`
  - `spec/sdk/types.md`
  - `spec/sdk/testing-gates.md`

### 修改 SDK 跨域规则

1. `spec/sdk/kernel/surface-contract.md`
2. `spec/sdk/kernel/transport-contract.md`
3. `spec/sdk/kernel/error-projection.md`
4. `spec/sdk/kernel/boundary-contract.md`

### 修改 SDK 子路径文档

1. 先改 `spec/sdk/kernel/*`（必要时含 `tables/*`）
2. 再改对应 `spec/sdk/*.md` domain 文档

## Platform（当前）

Platform 规范采用 kernel + domain 的两层结构，覆盖平台架构、协议、AI 最后一公里、开源治理。

- Kernel（唯一事实源）：`spec/platform/kernel/`
- Tables（事实源）：`spec/platform/kernel/tables/`
- Generated（自动生成视图）：`spec/platform/kernel/generated/`
- Domain：
  - `spec/platform/vision.md`
  - `spec/platform/architecture.md`
  - `spec/platform/protocol.md`
  - `spec/platform/ai-last-mile.md`
  - `spec/platform/ai-agent-security-interface.md`
  - `spec/platform/open-source-governance.md`

### 修改协议层 / 版本协商 / 原语

1. `spec/platform/kernel/protocol-contract.md`
2. `spec/platform/kernel/tables/protocol-error-codes.yaml`
3. `spec/platform/kernel/tables/protocol-primitives.yaml`
4. `spec/platform/protocol.md`

### 修改架构层 / 通信模式 / 凭证面

1. `spec/platform/kernel/architecture-contract.md`
2. `spec/platform/architecture.md`

### 修改 AI 最后一公里 / Hook Action Fabric

1. `spec/platform/kernel/ai-last-mile-contract.md`
2. `spec/platform/ai-last-mile.md`

### 修改开源治理 / License / 发布门

1. `spec/platform/kernel/governance-contract.md`
2. `spec/platform/open-source-governance.md`

### 修改合规测试 / 审计事件

1. `spec/platform/kernel/tables/compliance-test-matrix.yaml`
2. `spec/platform/kernel/tables/audit-events.yaml`
3. `spec/platform/protocol.md`

### 修改应用授权 / 参与者画像

1. `spec/platform/kernel/tables/app-authorization-presets.yaml`
2. `spec/platform/kernel/tables/participant-profiles.yaml`
3. `spec/platform/protocol.md`

## Realm（当前）

Realm 规范采用 kernel + domain 的两层结构，覆盖公共边界词汇、创作者经济、原语互操作映射。

- Kernel（唯一事实源）：`spec/realm/kernel/`
- Tables（事实源）：`spec/realm/kernel/tables/`
- Generated（自动生成视图）：`spec/realm/kernel/generated/`
- Domain：
  - `spec/realm/world.md`
  - `spec/realm/agent.md`
  - `spec/realm/social.md`
  - `spec/realm/world-creator-economy.md`
  - `spec/realm/creator-revenue-policy.md`
  - `spec/realm/app-interconnect-model.md`
  - `spec/realm/realm-interop-mapping.md`

### 修改公共边界词汇

1. `spec/realm/kernel/boundary-vocabulary-contract.md`
2. `spec/realm/kernel/tables/public-vocabulary.yaml`
3. 受影响 domain 文档（`world.md` / `agent.md` / `social.md`）

### 修改创作者经济 / 定价 / 收入

1. `spec/realm/kernel/economy-contract.md`
2. `spec/realm/kernel/tables/creator-key-tiers.yaml`
3. `spec/realm/kernel/tables/revenue-event-types.yaml`
4. `spec/realm/kernel/tables/share-plan-fields.yaml`
5. 受影响 domain 文档（`world-creator-economy.md` / `creator-revenue-policy.md`）

### 修改原语互操作映射

1. `spec/realm/kernel/interop-mapping-contract.md`
2. `spec/realm/kernel/tables/primitive-mapping-status.yaml`
3. `spec/realm/realm-interop-mapping.md`

## Future Capabilities

未来能力 backlog，汇总研究报告中可借鉴项，按优先级分类管理：

- Kernel（治理规则）：`spec/future/kernel/`
- Tables（事实源）：`spec/future/kernel/tables/`
- Generated（自动生成视图）：`spec/future/kernel/generated/`

### 添加新的未来能力条目

1. `spec/future/kernel/source-registry.md` — 确认来源已注册
2. `spec/future/kernel/capability-backlog.md` — 条目结构与生命周期
3. `spec/future/kernel/tables/backlog-items.yaml` — 添加条目

### 毕业条目到正式 spec

1. `spec/future/kernel/graduation-contract.md` — 毕业条件与流程
2. `spec/future/kernel/tables/graduation-log.yaml` — 记录毕业日志
