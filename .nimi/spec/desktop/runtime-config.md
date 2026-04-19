# Runtime Config Domain Spec

> Normative Imports: `.nimi/spec/desktop/kernel/*`

## Scope

运行时配置功能域 — AI Runtime 面板、provider 选择、model 绑定、daemon 管理、本地引擎状态、推荐页、cloud connector CRUD、mod AI 依赖管理。

## Module Map

- `features/runtime-config/` — Runtime 配置面板
- `features/runtime-config/pages/` — Runtime Config 页面组件（overview / recommend / local / cloud / runtime / mods / system pages）
- `features/runtime-config/panels/sidebar.tsx` — 左侧边栏导航
- `features/runtime-config/domain/` — 系统资源、费用预估 mock hooks

## Navigation And State

Runtime Config 面板的页面枚举、元数据、持久化 state 与 controller surface 由 kernel facts 和实现真相源统一治理，domain 层仅保留阅读锚点：

- 页面/左栏治理：`D-SHELL-023`、`D-SHELL-024`、`D-SHELL-025`
- Runtime 字段映射：`D-STATE-002`
- Runtime 配置页与 daemon/config/connector 投影：`D-IPC-002`、`D-IPC-003`、`D-ERR-009`

如需核对具体 page ID、localStorage 版本或 controller 字段，以实现真相源和对应 kernel rule 为准，不在此处重复定义本地 TypeScript 类型。

## Kernel References

### State (D-STATE-002)

Runtime 字段映射（`RuntimeFieldMap`）：
- `provider`：AI provider 选择
- `runtimeModelType`：模型能力类型（chat/image/video/tts/stt/embedding）
- `localProviderEndpoint` / `localProviderModel` / `localOpenAiEndpoint`：本地引擎绑定
- `connectorId`：connector 引用（K-KEYSRC-001 managed 路径）
- `scope`：connector 所有权范围（`'user'` / `'machine-global'` / `'runtime-system'`）；non-user scope 意味着 `isSystemOwned = true`；authenticated 用户创建默认 `'user'`，anonymous 创建默认 `'machine-global'`
- `targetType` / `targetAccountId` / `agentId` / `worldId`：可透传的执行上下文字段；Desktop core 不预置 Agent chat 目标
- `mode`：对话模式（STORY / SCENE_TURN）

### IPC (D-IPC-002)

Daemon 管理命令与状态投影见 `D-IPC-002`。

### IPC (D-IPC-003)

配置读写命令与 restart-required 语义见 `D-IPC-003`。

### Shell (D-SHELL-001)

Runtime Tab 受 `enableRuntimeTab` feature flag 门控。

### Sidebar Family (D-SHELL-023, D-SHELL-024, D-SHELL-025)

Runtime Config 内部左侧栏属于 desktop governed sidebar family：

- `runtime-config-panel-view` 必须登记到 `renderer-design-sidebars.yaml`。
- page navigation 只能使用 `nav-row` item kind；badge、status-dot 与 chevron 必须走受控 trailing affordance。
- runtime sidebar 不得继续维持独立背景色、独立 active row 或独立 resize handle contract。

### LLM (D-LLM-001)

Provider 适配层：`provider` 字段确定执行路径（remote token API / local runtime）。

### LLM (D-LLM-002)

Agent chat route 属于 host-only capability，不属于 Runtime Config product contract。

### LLM (D-LLM-003)

Connector 凭据路由：AI 请求凭据通过 `connector_id` 路由（K-KEYSRC-001 managed 路径），安全策略由 `D-SEC-009` 定义。

### LLM (D-LLM-004)

本地 LLM 健康检查：`checkLocalLlmHealth` 验证本地引擎可用性。

### Runtime Config Coupling

本域只消费 runtime config hard-cut 投影：

- loopback / supervised 托管边界：`D-SEC-001`、`D-IPC-003`
- restart-required 行为：`D-IPC-003`
- removed legacy runtime config surface：`D-ERR-009` 与上游 runtime config contract

### Memory Embedding Config Editor Boundary

Runtime Config 是 Desktop host live config 的 authority editor，不是 runtime
memory execution truth owner。

对 memory embedding config，Runtime Config 的固定边界为：

- Runtime Config 可以展示并编辑 Desktop-host-owned memory embedding adjacent
  live config
- 该 config 只表达 user-selected source / binding intent；不表达 resolved
  profile、bind success、bank identity、migration readiness、或 cutover completion
- Runtime Config 必须通过 admitted typed Desktop-host surface 读写这份 live
  config；不得把 renderer-local form state、private loopback HTTP、或本地资产启发式当成 canonical truth
- Runtime Config 对 runtime memory resolved state、bank availability、bind /
  rebuild / cutover readiness 的读取，必须通过 admitted typed host/runtime
  boundary；不得本地重算一份 memory mode truth
- 现有 private loopback convenience path（例如 canonical-bind 之类的
  endpoint）不得被 Runtime Config 长成正式产品 contract

### Security (D-SEC-001)

本地端点回环限制：仅允许 `localhost`、`127.0.0.1`、`[::1]`。

### Error (D-ERR-002)

端点校验错误码：`LOCAL_AI_ENDPOINT_NOT_LOOPBACK`、`LOCAL_AI_ENDPOINT_INVALID`。

### Offline / Degradation (D-OFFLINE-001, D-OFFLINE-003, D-OFFLINE-004)

- Realm 离线但 Runtime 可达时，`local` / `runtime` 两个页面继续可用，所有云 connector 写操作提示排队或在线要求。
- Runtime 与 Realm 同时不可达时，面板退化为只读浏览模式；daemon 管理、本地引擎启停、connector 写入与 EAA token 签发全部禁用。
- Runtime 重连成功后，面板必须刷新 daemon status、provider health、connector 配置与 External Agent gateway status。

## CI 门禁引用

本域涉及的 CI 门禁：

- `pnpm exec nimicoding validate-spec-governance --profile nimi --scope desktop-consistency`（Check 1, 11, 13~14, 18 相关规则）
- `pnpm check:desktop-cloud-runtime-only`
- `pnpm check:desktop-no-legacy-runtime-config-path`
