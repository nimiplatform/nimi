# Desktop AI 消费链路整改实施计划（2026-02-27）

- 日期：2026-02-27
- 类型：implementation plan（最终态，一次性收敛）
- 范围：`apps/desktop` + `apps/desktop/src-tauri` + `sdk`
- 输入依据：
  - `dev/report/desktop-ai-consumption-usability-audit-2026-02-27.md`
  - `dev/report/desktop-mod-hook-tauri-runtime-chain-audit-2026-02-27.md`

## 1. 目标与边界

本次整改目标是一次性打通并收敛两条链路，消除“UI 可见 key”与“runtime 实际认证链路”之间的语义断裂：

1. `runtime config -> tauri -> runtime`
2. `mod -> hook -> tauri -> runtime`

硬约束（整改完成后必须全部成立）：

1. Desktop 侧不再持久化或全局状态扩散明文 API key（`tokenApiKey`、`localOpenAiApiKey`）。
2. `route options` 与 `resolveRouteBinding` 的 secret 可见性语义一致：只返回非明文标识（`credentialRefId`/`apiKeyEnv`），不返回 secret。
3. runtime 推理认证路径单一：runtime 侧依赖 `apiKeyEnv`，desktop 侧仅在必要的“本地前置探测/语音直连”临时取 secret，且只在 core 内存态短暂使用。
4. 显式本地路由（`source=local-runtime`）默认 fail-close，不允许隐式 fallback 到 token-api。
5. runtime bridge 读取失败时禁止自动写回（read-before-write fail-close）。

## 2. 最终态链路定义

### 2.1 runtime config -> tauri -> runtime

1. UI 输入 connector key 后立即写入 vault/keyring（Tauri `credential_*`），state 仅保存 `credentialRefId`、`tokenApiKeyEnv`、`endpoint`、`vendor`。
2. localStorage 持久化仅包含非 secret 字段，不包含任何明文 token。
3. `runtime_bridge_config_set` 写入 runtime config 时仅投影为 `ai.providers.*.baseUrl + apiKeyEnv`。
4. runtime 按 `apiKeyEnv` 读取环境变量，拒绝明文 `apiKey`（保持现有 secret policy）。

### 2.2 mod -> hook -> tauri -> runtime

1. mod 查询 `data-api.runtime.route.options` 仅获取 route/connector/model 信息，不含 secret。
2. mod 调 `resolveRouteBinding` 获取 provider/model/source + `credentialRefId`（不含 key）。
3. `generateText/image/video/embedding/stt` 仍走 runtime RPC `routePolicy + modelId`，不透传明文 key。
4. 语音链路（tts/voice list/stream）在 core 侧按 `credentialRefId` 向 vault 取 secret，仅用于当前请求 header，不写回 store。

## 3. 一次性改造清单（文件级）

### 3.1 配置模型与持久化（去明文化）

| 文件 | 改造内容 |
|---|---|
| `apps/desktop/src/shell/renderer/features/runtime-config/state/v11/types/connector.ts` | `ApiConnector` 移除 `tokenApiKey`，新增 `credentialRefId`；`createConnectorV11/normalizeConnectorV11` 同步更新。 |
| `apps/desktop/src/shell/renderer/features/runtime-config/state/v11/storage/defaults.ts` | `RuntimeConfigSeedV11` 移除 `localOpenAiApiKey`；默认 connector 不再携带 token。 |
| `apps/desktop/src/shell/renderer/features/runtime-config/state/v11/storage/normalize.ts` | 旧 `tokenApiKey` 字段仅做读取兼容并立即擦除输出，规范化后 state 不再含明文字段。 |
| `apps/desktop/src/shell/renderer/features/runtime-config/state/v11/storage/persist.ts` | 持久化 payload 仅存非 secret 字段，确保 localStorage 不落明文 key。 |
| `apps/desktop/src/shell/renderer/features/runtime-config/effects/hydration.ts` | 载入阶段移除 `localOpenAiApiKey` 依赖；若检测到旧存储中的明文 key，执行一次性 vault 导入并清除旧字段。 |
| `apps/desktop/src/shell/renderer/features/runtime-config/runtime-bridge-config.ts` | 删除对 `tokenApiKey` 的读写逻辑；保留 `tokenApiKeyEnv` -> `apiKeyEnv` 投影。 |
| `apps/desktop/src/shell/renderer/features/runtime-config/state/runtime-route-resolver-v11.ts` | `Resolved*Config` 移除 `localOpenAiApiKey`，改为 `credentialRefId`。 |
| `apps/desktop/src/shell/renderer/app-shell/providers/store-types.ts` | `RuntimeFieldMap` 移除 `localOpenAiApiKey`。 |
| `apps/desktop/src/shell/renderer/app-shell/providers/store-slices/runtime-slice.ts` | `setRuntimeDefaults` 不再注入 `localOpenAiApiKey`。 |

### 3.2 Connector UI 与 Vault 主流程接入

| 文件 | 改造内容 |
|---|---|
| `apps/desktop/src/shell/renderer/features/runtime-config/panels/setup/token-api-connectors-page.tsx` | 输入项从“Session API Key 写 state”改为“写入 Vault”（提交即 upsert secret）；UI 仅显示 ref 状态。 |
| `apps/desktop/src/shell/renderer/features/runtime-config/panels/provider-connectors-panel.tsx` | `onChangeConnectorToken` 改为 vault 写入动作，state patch 改写 `credentialRefId`。 |
| `apps/desktop/src/shell/renderer/features/runtime-config/panels/provider-connectors/connector-actions.ts` | 删除 `tokenApiKey` patch 支持；新增 `credentialRefId` patch。 |
| `apps/desktop/src/shell/renderer/features/runtime-config/effects/vault-sync.ts` | 统计逻辑改为按 provider/refId 读取真实 vault entries，不再仅做全量数。 |
| `apps/desktop/src/shell/renderer/features/runtime-config/panels/provider-connectors/view.tsx` | Overview `vaultEntryCount` 改为使用 controller 的真实 vault 计数，不再用 `connector.tokenApiKey` 估算。 |
| `apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller.ts` | 注入 connector-vault 同步：新增/更新/删除 connector 时同步 `credential_upsert/delete_*`。 |
| `apps/desktop/src/shell/renderer/features/runtime-config/domain/provider-connectors/discovery.ts` | `discoverConnectorModelsAndHealth` 改为按 `credentialRefId` 从 vault 获取 secret（仅内存临时值）。 |

### 3.3 Route 解析契约统一（mod/hook 侧不见明文）

| 文件 | 改造内容 |
|---|---|
| `sdk/src/mod/types/llm.ts` | `ResolvedRuntimeRouteBinding` 删除 `localOpenAiApiKey`，新增 `credentialRefId?: string`。 |
| `sdk/src/mod/types/runtime-hook/llm.ts` | Hook LLM 输入结构去掉 `localOpenAiApiKey`，改可选 `credentialRefId`（仅 runtime core 可消费）。 |
| `sdk/src/mod/internal/host-types.ts` | host type 同步去明文化字段。 |
| `sdk/src/mod/internal/runtime-access.ts` | route health payload 去 `localOpenAiApiKey`；必要时透传 `credentialRefId`。 |
| `sdk/src/mod/ai/index.ts` | `routeRuntimePayload` 删除 `localOpenAiApiKey` 透传。 |
| `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-resolvers.ts` | `toResolvedRuntimeRouteBinding` 返回 `credentialRefId`，不返回明文 key。 |
| `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-data-capabilities/runtime-route-capabilities.ts` | route options hydration 改为按 `credentialRefId` 临时取 secret，返回体仍不含 key。 |
| `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-utils.ts` | `hydrateConnectorModels` 参数由 `tokenApiKey` 改为 `credentialRefId` + resolver（延迟取 secret）。 |

### 3.4 语音链路整改（speech 仍可用，但不泄露 key）

| 文件 | 改造内容 |
|---|---|
| `apps/desktop/src/runtime/hook/contracts/types.ts` | `SpeechRouteResolution` 移除 `localOpenAiApiKey`，新增 `credentialRefId?: string`。 |
| `apps/desktop/src/runtime/hook/services/speech/types.ts` | `RouteResolverResult/ResolvedRoute` 同步改为 credential ref。 |
| `apps/desktop/src/runtime/hook/services/speech-service.ts` | route 结果改用 `credentialRefId`，调用前统一通过 vault resolver 获取 secret。 |
| `apps/desktop/src/runtime/hook/services/speech/synthesize.ts` | 删除对 `resolved.localOpenAiApiKey` 依赖；改用 `resolveSpeechSecret(route)`。 |
| `apps/desktop/src/runtime/hook/services/speech/stream.ts` | 同上，stream open/control 生命周期不落盘 secret。 |
| `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts` | `setSpeechRouteResolver` 返回结构同步去明文。 |

### 3.5 推理调用与 health 输入去除 dead field

| 文件 | 改造内容 |
|---|---|
| `apps/desktop/src/runtime/hook/services/llm-service.ts` | 所有 `Llm*Input` 移除 `localOpenAiApiKey`。 |
| `apps/desktop/src/runtime/llm-adapter/execution/types.ts` | `Invoke*Input/CheckLlmHealthInput/ExecuteLocalKernelTurnInput` 去掉 `localOpenAiApiKey` 或替换为 `credentialRefId`。 |
| `apps/desktop/src/runtime/llm-adapter/execution/health-check.ts` | 健康检查若需 token，改由调用方提供临时 secret（不经 store）。 |
| `apps/desktop/src/runtime/llm-adapter/execution/kernel-turn.ts` | 删除无效 `localOpenAiApiKey` 透传。 |
| `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities.ts` | `toHealthInput/toKernelTurnInput` 移除 runtimeFields 上的 key fallback。 |

### 3.6 runtime defaults 与 tauri 出口收口

| 文件 | 改造内容 |
|---|---|
| `apps/desktop/src/shell/renderer/bridge/runtime-bridge/types.ts` | `RuntimeExecutionDefaults`、`parseRuntimeDefaults` 移除 `localOpenAiApiKey`。 |
| `apps/desktop/src/shell/renderer/bridge/runtime-bridge/runtime-defaults.ts` | fallback 不再读取 `NIMI_LOCAL_OPENAI_API_KEY`。 |
| `apps/desktop/src-tauri/src/main.rs` | `RuntimeExecutionDefaults` 删除 `local_open_ai_api_key` 字段与 `runtime_defaults()` 注入。 |

### 3.7 fallback 与写回保护（可用性修复）

| 文件 | 改造内容 |
|---|---|
| `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-resolvers.ts` | 增加 strict-local 判定：显式 `source=local-runtime` 时禁止 fallback 到 token-api。 |
| `apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller.ts` | 引入 `runtimeBridgeReadSucceededRef`，未成功 read 前禁止 `setRuntimeBridgeConfig` 自动写回。 |
| `apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller.ts` | read fail banner 增加重试动作；read success 后再开启 write effect。 |

## 4. 验收标准（必须全部满足）

1. `apps/desktop/src` + `sdk/src/mod` 不再存在业务字段 `tokenApiKey`、`localOpenAiApiKey`（迁移兼容代码除外，且仅限一次性迁移分支）。
2. localStorage payload（`nimi.runtime.llm-config.*`）不含明文 key。
3. `resolveRouteBinding`、`data-api.runtime.route.options` 返回体不含明文 key。
4. 显式 `local-runtime` 选择在缺模/缺能力时返回错误，不发生隐式 token-api fallback。
5. runtime bridge 读失败后，state 变更不会触发写回；读成功后恢复正常写回。
6. Overview/Diagnostics 的 vault 计数与 `credential_list_entries` 一致。

## 5. 验证命令

```bash
cd /Users/snwozy/nimi-realm/nimi

# 1) 关键字段扫描（整改后应为 0 或仅迁移代码）
rg -n "tokenApiKey|localOpenAiApiKey" apps/desktop/src sdk/src/mod

# 2) desktop 类型与单测
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec tsx --test \
  test/runtime-route-resolver-v11.test.ts \
  test/runtime-bridge-config.test.ts \
  test/runtime-bootstrap-speech-route-resolver.test.ts

# 3) tauri 侧构建/测试（如有新增测试）
pnpm -C apps/desktop/src-tauri exec cargo test
```

## 6. 新增/调整测试项

1. `runtime-route-resolver-v11`：断言返回 `credentialRefId`，不返回明文 key。
2. `runtime-bridge-config`：断言 projection 与 apply/build 不依赖 `tokenApiKey`。
3. `runtime-bootstrap-speech-route-resolver`：断言 speech route 返回 credential ref，并在 resolver 端拒绝明文字段。
4. 新增 `runtime-config-persist-secretless`：断言 localStorage payload 无 secret。
5. 新增 `runtime-config-read-fail-no-writeback`：断言 bridge read fail 后不触发 set。
6. 新增 `runtime-route-strict-local`：断言显式 local-runtime 下 fallback 被禁止。

## 7. 实施顺序（同一 PR 内完成）

1. 先完成类型与数据模型收敛（connector/state/sdk type）。
2. 再接入 vault 主流程并替换 discovery/speech secret 读取。
3. 然后收敛 route resolver 与 fallback 语义。
4. 最后完成 bridge read-fail 写回保护、overview 指标修正与测试补齐。

说明：顺序用于降低冲突与回归风险，不引入中间态发布，不保留兼容壳。
