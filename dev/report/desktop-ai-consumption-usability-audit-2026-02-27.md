# Nimi Desktop AI 消费链路可用性审计（2026-02-27）

- 审计日期：2026-02-27
- 审计范围：`apps/desktop`、`apps/desktop/src-tauri`、`sdk`（静态代码审计）
- 审计目标：核对并审计两条链路
  1. `mod -> hook -> tauri -> runtime`
  2. `runtime config -> tauri -> runtime`

## 1. 你的流程是否准确

你的理解：
1. AI Runtime -> 配置 Cloud API -> Add Connector -> Save Connector to Runtime
2. Local-chat -> 获取 chat list(拿不到 api key) -> assemble prompt -> Tauri -> Runtime -> generateText -> Tauri -> mod

结论：**方向基本正确，但有 4 个关键差异**。

1. `Save Connector to Runtime` 不是显式点击保存，而是面板自动写回（debounce）。
- 证据：`apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller.ts:525-570`

2. `chat route options` 查询层确实拿不到 key；但 `resolveRouteBinding` 调用层会拿到 `localOpenAiApiKey`。
- 证据（query 不含 key）：`apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-data-capabilities/runtime-route-capabilities.ts:322-335`、`sdk/src/mod/runtime-route.ts:149-174`
- 证据（binding 含 key）：`apps/desktop/src/shell/renderer/features/runtime-config/state/runtime-route-resolver-v11.ts:241,314`、`apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-resolvers.ts:52,67`

3. 你说的 “Tauri -> Runtime -> generateText” 对；但当前 text/image/video/embedding/stt 实际调用 runtime RPC 时并不携带 `tokenApiKey`，只传 route policy/model。
- 证据：`apps/desktop/src/runtime/llm-adapter/execution/invoke-text.ts:35-53`、`apps/desktop/src/runtime/llm-adapter/execution/invoke-image.ts:33-42`、`apps/desktop/src/runtime/llm-adapter/execution/invoke-video.ts:33-42`、`apps/desktop/src/runtime/llm-adapter/execution/invoke-embedding.ts:60-68`、`apps/desktop/src/runtime/llm-adapter/execution/invoke-transcribe.ts:39-48`

4. runtime config 写入 runtime 侧时，主数据是 `apiKeyEnv`（环境变量引用），不是 UI 里的明文 token。
- 证据：`apps/desktop/src/shell/renderer/features/runtime-config/runtime-bridge-config.ts:380-385`、`apps/desktop/src/shell/renderer/features/runtime-config/runtime-bridge-config.ts:397-399`；runtime 校验禁止 `apiKey` 明文：`runtime/internal/config/config.go:334-340`

## 2. 实际链路（核对版）

### 2.1 runtime config -> tauri -> runtime

1. UI 编辑 connector（包含 `tokenApiKey`、`tokenApiKeyEnv`）写入前端 state。
- `apps/desktop/src/shell/renderer/features/runtime-config/panels/provider-connectors-panel.tsx:52-58`

2. state 会持久化到 localStorage（含 connectors 全量字段）。
- `apps/desktop/src/shell/renderer/features/runtime-config/state/v11/storage/persist.ts:28-47`

3. 进入 bridge 投影时，只把 provider `baseUrl + apiKeyEnv` 写给 runtime config。
- `apps/desktop/src/shell/renderer/features/runtime-config/runtime-bridge-config.ts:322-399`

4. renderer 调 tauri 命令 `runtime_bridge_config_set/get`，tauri 侧转发 `nimi config set/get --json`。
- `apps/desktop/src/shell/renderer/bridge/runtime-bridge/runtime-daemon.ts:54-64`
- `apps/desktop/src-tauri/src/runtime_bridge/mod.rs:129-136`
- `apps/desktop/src-tauri/src/runtime_bridge/daemon_manager.rs:421-427`

5. runtime config 层强制 secret policy：禁止 `apiKey` 明文，要求 `apiKeyEnv`。
- `runtime/internal/config/config.go:334-340`

### 2.2 mod -> hook -> tauri -> runtime（local-chat）

1. local-chat 是默认 mod，使用 `@nimiplatform/sdk/mod/hook` 和 `@nimiplatform/sdk/mod/ai`。
- `apps/desktop/src-tauri/resources/default-mods/local-chat/mod.manifest.yaml:1-6`
- `apps/desktop/src-tauri/resources/default-mods/local-chat/dist/mods/local-chat/index.js:7114-7115`

2. local-chat 先 query `data-api.runtime.route.options`（不含 key），并可 `aiClient.resolveRoute`。
- `apps/desktop/src-tauri/resources/default-mods/local-chat/dist/mods/local-chat/index.js:3745-3751`、`apps/desktop/src-tauri/resources/default-mods/local-chat/dist/mods/local-chat/index.js:3762-3793`、`apps/desktop/src-tauri/resources/default-mods/local-chat/dist/mods/local-chat/index.js:3714-3724`

3. prompt 在 mod 内组装，再调用 `aiClient.generateText/generateObject`。
- `apps/desktop/src-tauri/resources/default-mods/local-chat/dist/mods/local-chat/index.js:4762-4801`、`apps/desktop/src-tauri/resources/default-mods/local-chat/dist/mods/local-chat/index.js:4887`、`apps/desktop/src-tauri/resources/default-mods/local-chat/dist/mods/local-chat/index.js:5010`

4. sdk `createAiClient` 会 `resolveRouteBinding`，再调用 `runtime.generateModText`。
- `sdk/src/mod/ai/index.ts:89-108`

5. desktop hook -> llm adapter -> runtime SDK（tauri-ipc）-> tauri runtime_bridge -> runtime daemon。
- `apps/desktop/src/runtime/hook/services/llm-service.ts:143-173`
- `apps/desktop/src/runtime/llm-adapter/execution/invoke-text.ts:34-53`
- `sdk/src/runtime/transports/tauri-ipc/index.ts:233-244`
- `apps/desktop/src-tauri/src/runtime_bridge/mod.rs:79-83`

## 3. 可用性问题与优化点（按严重度）

### P0-1 UI 填写的 `tokenApiKey` 与真实 runtime 推理认证链路脱钩

现象：
- UI/route 层反复传递 `localOpenAiApiKey`，但真实 `runtime.ai.generate*` 请求不带该 key。
- runtime 侧实际依赖配置中的 `apiKeyEnv`（对应进程环境变量）。

影响：
- 用户“填了 key，健康检查也通过，但实际生成失败”的高概率错觉。
- 排障成本高，体验断裂。

证据：
- key 被组装：`sdk/src/mod/ai/index.ts:42-61`
- 但 generate 未使用 key：`apps/desktop/src/runtime/llm-adapter/execution/invoke-text.ts:35-53`
- runtime config 仅写 `apiKeyEnv`：`apps/desktop/src/shell/renderer/features/runtime-config/runtime-bridge-config.ts:380-385`

### P0-2 明文 key 在 desktop 侧存储与扩散面过大

现象：
- connector token 明文进入 state + localStorage。
- `runtimeFields.localOpenAiApiKey` 也进入全局 store。

影响：
- 与“runtime 使用 envRef/keyring”的策略冲突。
- 增大被 mod/UI 扩展意外读取的风险面。

证据：
- connector 明文字段定义：`apps/desktop/src/shell/renderer/features/runtime-config/state/v11/types/connector.ts:67-74`
- 本地持久化 connectors：`apps/desktop/src/shell/renderer/features/runtime-config/state/v11/storage/persist.ts:38-40`
- runtimeFields 包含 key：`apps/desktop/src/shell/renderer/app-shell/providers/store-types.ts:26-40`

### P1-1 Vault/keyring 能力存在，但 connector 主流程未真正接入

现象：
- controller 创建 `TauriCredentialVault`，但主流程只做 `listCredentialEntries` 计数。
- token 输入仍直接写 `tokenApiKey` state。

影响：
- keyring 形同“旁路能力”，无法成为默认 secret 通道。

证据：
- vault 仅计数：`apps/desktop/src/shell/renderer/features/runtime-config/effects/vault-sync.ts:15-22`
- token 直接写 state：`apps/desktop/src/shell/renderer/features/runtime-config/panels/provider-connectors-panel.tsx:52-58`

### P1-2 route options 与 route binding 的密钥可见性语义不一致

现象：
- `route options` 不含 token；`resolveRouteBinding` 却包含 `localOpenAiApiKey`。

影响：
- 用户与开发者容易误判“mod 拿不到 key”。

证据：
- options 不含 key：`apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-data-capabilities/runtime-route-capabilities.ts:322-335`
- binding 含 key：`apps/desktop/src/shell/renderer/features/runtime-config/state/runtime-route-resolver-v11.ts:241,314`

### P1-3 local-runtime 失败会自动 fallback token-api，且并未严格尊重“显式本地”预期

现象：
- 仅排除 `overrideSource=token-api`，其余（含 local-runtime）在特定错误下都可能 fallback。

影响：
- 隐私/成本预期偏差，行为不透明。

证据：
- `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-resolvers.ts:214-220`

### P2-1 runtime config 读取失败后仍可进入自动写回阶段

现象：
- bridge 读失败也会将 `runtimeBridgeReadyRef` 置 true，后续 state 变化可能触发写回。

影响：
- 可能基于“非 runtime 基线”的本地状态产生配置漂移。

证据：
- `apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller.ts:505-515`、`apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller.ts:525-540`

### P2-2 Overview 中“Vault Entries”统计口径与真实 vault 不一致

现象：
- Overview 页面把 `vaultEntryCount` 传成 `connectors.filter(tokenApiKey).length`，并非真实 keyring entries。

影响：
- UI 指标误导，进一步加剧“secret 已安全保存”的错觉。

证据：
- `apps/desktop/src/shell/renderer/features/runtime-config/panels/provider-connectors/view.tsx:83`
- 对比真实 vault count 来源：`apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller.ts:585` + `apps/desktop/src/shell/renderer/features/runtime-config/effects/vault-sync.ts:15-18`

## 4. 建议整改路径（可直接执行）

1. Secret 通道收敛（P0）
- `tokenApiKey` 不再写 localStorage/state。
- connector 只保留 `credentialRefId` + `tokenApiKeyEnv`。
- 明文只在 keyring（tauri credential_*）内存在。

2. 推理认证单一路径（P0）
- 二选一，必须统一：
  - A. 完全 runtime-side（推荐）：runtime 仅认 `apiKeyEnv`，UI 强制引导配置 envRef/keyring->env 注入。
  - B. 显式 request-side：若要支持“会话 key”，需把 key 经受控字段传到 runtime，并在 runtime 服务端严格治理与脱敏审计。

3. 语义统一（P1）
- `resolveRouteBinding` 默认不返回明文 key；改为 `credentialRefId` 或 opaque token handle。
- `route options`/`route binding` 对“是否可见 secret”行为保持一致。

4. fallback 策略显式化（P1）
- 新增 strict local 开关：显式 local-route 时禁止自动 token-api fallback。
- 在 UI 与日志中明确 route decision（local/token）与触发原因。

5. 写回保护与指标修正（P2）
- bridge read 失败时禁用自动 write-back，直到 read 成功。
- Overview 的 vault 指标改为真实 keyring entries。

## 5. 对你当前描述的最终确认

- 你的主链路认知是“**大体正确**”。
- 但当前实现中，最关键的区别是：
  1. `route options` 层拿不到 key，不代表调用层拿不到。
  2. UI 填写 `tokenApiKey` 与 runtime 真正执行认证链路并不一致。

这两点正是“现在有各种问题”的核心来源。
