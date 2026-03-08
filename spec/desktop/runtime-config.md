# Runtime Config Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

运行时配置功能域 — AI Runtime 面板、provider 选择、model 绑定、daemon 管理、本地引擎状态、cloud connector CRUD、mod AI 依赖管理。

## Module Map

- `features/runtime-config/` — Runtime 配置面板
- `features/runtime-config/pages/` — 5 个页面组件（overview / local / cloud / runtime / mods）
- `features/runtime-config/panels/sidebar.tsx` — 左侧边栏导航
- `features/runtime-config/domain/` — 系统资源、费用预估 mock hooks
- `runtime/data-sync/facade.ts` — resolveChatRoute

## Navigation Model

Runtime 配置面板采用 **左侧边栏 + 内容区** 两栏布局，不再使用 scope/tab 双层路由。

### Page 枚举

```typescript
type RuntimePageIdV11 = 'overview' | 'local' | 'cloud' | 'runtime' | 'mods';
```

| Page | 组件 | 职责 |
|------|------|------|
| `overview` | `OverviewPage` | Dashboard：统计卡片、系统资源监控、费用预估、Capability 覆盖矩阵、Daemon 状态、快捷导航 |
| `local` | `LocalPage` | 本地模型管理：搜索/安装/导入/启停/删除、下载进度、catalog、HuggingFace 搜索 |
| `cloud` | `CloudPage` | Cloud Connector CRUD：添加/删除/编辑/测试 connector、vendor/endpoint/token 配置 |
| `runtime` | `RuntimePage` | Runtime 管理：Endpoint 配置、Daemon 生命周期、健康探测、审计日志、EAA、Provider 诊断、Node Matrix |
| `mods` | `ModsPage` | Mod AI 依赖：列出 AI 依赖 mods、capability 状态检查、依赖解析与 apply |

### Page 元数据

`RUNTIME_PAGE_META: Record<RuntimePageIdV11, { name: string; description: string }>` 定义每个页面的名称和描述，供 sidebar 和 header 使用。

### Legacy 值迁移

`normalizePageIdV11(value)` 处理旧版持久化值：

| 旧值 | 映射目标 |
|------|----------|
| `'models'` | `'local'` |
| `'cloud-api'` / `'cloud'` / `'cloud'` | `'cloud'` |
| `'providers'` / `'audit'` | `'runtime'` |
| 其他未知值 | `'overview'` |

## Panel State

`RuntimeConfigStateV11` 为面板 UI 状态，通过 localStorage 持久化（key: `nimi:runtime-config:v11`）。

```typescript
type RuntimeConfigStateV11 = {
  version: 11;
  initializedByV11: boolean;
  activePage: RuntimePageIdV11;       // 当前选中页面
  diagnosticsCollapsed: boolean;
  selectedSource: SourceIdV11;        // 'local' | 'cloud'
  activeCapability: CapabilityV11;    // 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding'
  uiMode: UiModeV11;                 // 'simple' | 'advanced'
  local: LocalStateV11; // 端点、模型列表、node matrix、状态
  connectors: ApiConnector[];         // NOT persisted — bridge config 是 single source of truth
  selectedConnectorId: string;        // NOT persisted — bridge config 是 single source of truth
};
```

### 持久化策略

- `activePage`、`diagnosticsCollapsed`、`uiMode`、`selectedSource`、`activeCapability`、`local` 持久化到 localStorage。
- `connectors` 和 `selectedConnectorId` **不持久化**到 localStorage，通过 Tauri bridge config（`config.json`）作为 single source of truth，bridge merge 后填充。
- `StoredStateV11` 是 localStorage 子集，不含 `connectors` / `selectedConnectorId`。

### State 归一化

`normalizeStoredStateV11(seed, parsed)` 从 localStorage 读取后归一化：
- 支持 legacy 字段名 `activeSetupPage` → `activePage`
- 每个字段通过对应 normalizer 校验（`normalizePageIdV11`、`normalizeSourceV11`、`normalizeCapabilityV11` 等）
- connectors 始终初始化为 `[]`（不从 localStorage 加载）

## Controller Model

`RuntimeConfigPanelControllerModel` 是 view 层的唯一数据+操作接口：

- `activePage: RuntimePageIdV11` — 当前页面
- `onChangePage(page: RuntimePageIdV11)` — 切换页面
- daemon lifecycle（start/stop/restart/refresh）
- model management（install/remove/start/stop, catalog, HF search, file import）
- connector CRUD（通过 connector-sdk-service + connector-actions）
- EAA token management
- audit data streaming
- dependency resolution（mod AI 依赖）

## Kernel References

### State (D-STATE-002)

Runtime 字段映射（`RuntimeFieldMap`）：
- `provider`：AI provider 选择
- `runtimeModelType`：模型能力类型（chat/image/video/tts/stt/embedding）
- `localProviderEndpoint` / `localProviderModel` / `localOpenAiEndpoint`：本地引擎绑定
- `connectorId`：connector 引用（K-KEYSRC-001 managed 路径）
- `targetType` / `targetAccountId` / `agentId` / `worldId`：执行目标
- `mode`：对话模式（STORY / SCENE_TURN）

### IPC (D-IPC-002)

Daemon 管理命令（命令清单见 `D-IPC-002`）。

### IPC (D-IPC-003)

配置读写命令（命令清单见 `D-IPC-003`）。

### Shell (D-SHELL-001)

Runtime Tab 受 `enableRuntimeTab` feature flag 门控。

### LLM (D-LLM-001)

Provider 适配层：`provider` 字段确定执行路径（remote token API / local runtime）。

### LLM (D-LLM-002)

路由策略：通过 `resolveChatRoute` 确定目标 agent 和 provider。

### LLM (D-LLM-003)

Connector 凭据路由：AI 请求凭据通过 `connector_id` 路由（K-KEYSRC-001 managed 路径），安全策略由 `D-SEC-009` 定义。

### LLM (D-LLM-004)

本地 LLM 健康检查：`checkLocalLlmHealth` 验证本地引擎可用性。

### Runtime Config Coupling

- 当 `providers.local.baseUrl` 配置为回环地址（`localhost`/`127.0.0.1`/`::1`）且未显式关闭 `engines.localai.enabled` 时，runtime 将自动进入 LocalAI SUPERVISED 托管启动。
- 因此 `providers.local.*` 与 `engines.*` 变更属于 runtime 启动期固化配置，Desktop 应在收到 `CONFIG_RESTART_REQUIRED` 时提示并引导重启 daemon。

### Security (D-SEC-001)

本地端点回环限制：仅允许 `localhost`、`127.0.0.1`、`[::1]`。

### Error (D-ERR-002)

端点校验错误码：`LOCAL_AI_ENDPOINT_NOT_LOOPBACK`、`LOCAL_AI_ENDPOINT_INVALID`。

## CI 门禁引用

本域涉及的 CI 门禁：

- `pnpm check:desktop-spec-kernel-consistency`（Check 1, 11, 13~14, 18 相关规则）
- `pnpm check:desktop-cloud-runtime-only`
- `pnpm check:desktop-no-legacy-runtime-config-path`
