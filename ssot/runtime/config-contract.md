---
title: Nimi Runtime Config Contract
status: ACTIVE
updated_at: 2026-02-27
rules:
  - Runtime Config 是 runtime 启动、provider 连接、CLI/desktop 配置交互的唯一配置真相。
  - 配置写入主权固定由 nimi-cli 持有；desktop 仅通过 tauri bridge 调用 CLI。
  - `daemon-config plane` 的配置变更采用 restart required 语义；禁止运行中热加载。
---

# Runtime Config SSOT（全链路）

## 1. Goals and Scope

目标：定义 `runtime`、`nimi-cli`、`nimi-desktop` 对 Runtime Config 的统一合同，消除多入口写入与路径歧义。

范围：

1. `MUST`：Runtime Config 覆盖 runtime 启动参数、AI provider 连接参数、配置迁移与校验规则。
2. `MUST`：本合同覆盖 `runtime` 读取、`nimi-cli` 写入、`desktop` 桥接读写三个执行面。
3. `MUST`：UI 本地偏好（如 localStorage 的页面选择状态）不属于 Runtime Config 真相域。
4. `SHOULD`：开发与发布文档均引用本合同，不在多处复制规范细节。

## 2. Domain Boundaries

职责边界：

1. `runtime`：`MUST` 负责配置读取、迁移触发、Schema/secret 校验、ENV 投影。
2. `nimi-cli`：`MUST` 作为唯一配置写入口，负责 `init|get|set|validate|migrate` 子命令。
3. `nimi-desktop`：`MUST` 通过 tauri command 调用 CLI 子命令读写；`MUST NOT` 直接 `fs::write` Runtime Config。
4. `runtime`/`desktop`：`MUST` 使用同一默认路径与迁移规则，避免读写不一致。

## 3. Contract

### 3.1 Path Resolution and Migration

1. `MUST`：路径解析顺序固定为 `NIMI_RUNTIME_CONFIG_PATH` -> `~/.nimi/config.json`。
2. `MUST`：默认路径从 `~/.nimi/runtime/config.json` 切换到 `~/.nimi/config.json`。
3. `MUST`：自动迁移仅在以下条件同时满足时触发：
   1. 未显式设置 `NIMI_RUNTIME_CONFIG_PATH`。
   2. 新路径 `~/.nimi/config.json` 不存在。
   3. 旧路径 `~/.nimi/runtime/config.json` 存在。
4. `MUST`：迁移后执行硬切换（旧路径删除）；runtime 后续仅识别新路径。
5. `SHOULD`：迁移写入采用原子替换，避免中间态脏文件。

### 3.2 Priority and Effect Semantics

1. `MUST`：优先级固定为 `CLI flags > ENV > config file > built-in defaults`。
2. `MUST`：`daemon-config plane` 配置修改后必须重启 runtime 生效（`restart required`）。
3. `MUST NOT`：runtime 不得 watch 配置文件并进行热加载。

### 3.3 Schema and Defaults

1. `MUST`：配置顶层包含 `schemaVersion`，当前固定值为 `1`。
2. `MUST`：保留并维护 `runtime` 与 `ai.providers` 结构。
3. `MUST`：默认值如下（若上层优先级未覆盖）：

| Key | Default |
|---|---|
| `runtime.grpcAddr` | `127.0.0.1:46371` |
| `runtime.httpAddr` | `127.0.0.1:46372` |
| `runtime.shutdownTimeout` | `10s` |
| `runtime.localRuntimeStatePath` | `~/.nimi/runtime/local-runtime-state.json` |
| `ai.httpTimeout` | `30s` |
| `ai.healthInterval` | `8s` |

### 3.4 Provider Naming and Env Binding

1. `MUST`：provider 配置项以 `ai.providers.<provider>` 表达，支持别名归一（示例：`cloud-gemini` -> `gemini`）。
2. `MUST`：provider API key 来源通过 `apiKeyEnv` 绑定到环境变量。
3. `MUST`：Gemini 保留 key alias：当 `NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY` 为空时可回退 `GEMINI_API_KEY`。
4. `MUST`：当 Gemini key 存在且 base URL 为空时，默认补全 `https://generativelanguage.googleapis.com/v1beta/openai`。

### 3.5 Secret Policy

1. `MUST NOT`：配置文件出现明文字段 `apiKey`。
2. `MUST`：`ai.providers.*.apiKeyEnv` 为必填。
3. `SHOULD`：预留 `secretRef` 扩展位用于后续 vault 接入。

### 3.6 Write Contract

1. `MUST`：仅 `nimi config set` 允许写 Runtime Config。
2. `MUST`：写入路径执行文件锁，冲突时返回 `CONFIG_WRITE_LOCKED`。
3. `MUST`：写入执行顺序固定为 `parse -> validate -> atomic write`。
4. `MUST`：desktop 写入通过 tauri command 调 CLI，不直接写配置文件。

### 3.7 Credential Planes and Host-Bound Request Credentials

1. `MUST`：区分两类凭证平面，且语义不可混用：
   1. `daemon-config plane`：由 `ai.providers.*.apiKeyEnv` 驱动，服务于 runtime 进程配置读取与 CLI/headless 调用。
   2. `request-credential plane`：由受信宿主在请求期注入 provider secret，服务于 desktop/mod token-api 调用。
2. `MUST`：`restart required` 仅适用于 `daemon-config plane` 的配置变更，不适用于 `request-credential plane` 的密钥轮换。
3. `MUST`：同一逻辑连接器对应的密钥更新必须在下一次请求生效，不得要求 runtime 重启。
4. `MUST`：当请求显式携带请求期凭证时，执行面必须优先使用该凭证，不得静默回落到 daemon 启动时凭证。
5. `MUST NOT`：Runtime Config 文件持久化明文请求期 secret。
6. `SHOULD`：`connectorId -> secret` 解析由 desktop/host 侧负责，runtime 仅消费请求中已注入的 provider secret 与 endpoint 参数。

## 4. Failure Semantics (`reasonCode` / `actionHint`)

| reasonCode | actionHint |
|---|---|
| `CONFIG_PARSE_FAILED` | `运行 nimi config validate 并修复 JSON/字段格式` |
| `CONFIG_SCHEMA_INVALID` | `修复 schemaVersion/必填字段后重试` |
| `CONFIG_MIGRATION_FAILED` | `运行 nimi config migrate 并检查路径权限` |
| `CONFIG_WRITE_LOCKED` | `等待其他写操作完成后重试 nimi config set` |
| `CONFIG_SECRET_POLICY_VIOLATION` | `移除明文 apiKey，改为 apiKeyEnv/secretRef` |
| `CONFIG_RESTART_REQUIRED` | `重启 runtime 使配置生效` |

约束：

1. `MUST`：CLI 与 desktop bridge 返回错误时携带可识别 `reasonCode`。
2. `MUST`：每个 `reasonCode` 对应可执行 `actionHint`。

## 5. Acceptance and Test Gates

必须通过以下门禁：

1. `runtime` 单测：迁移、优先级、默认值、provider env 映射、secret policy。
2. `nimi-cli` 单测：`init|get|set|validate|migrate` 全覆盖。
3. `desktop` tauri 单测：新路径读取、CLI 写入调用、错误冒泡。
4. 集成场景：旧路径自动迁移后启动成功，且仅新路径生效。

验证命令：

```bash
cd runtime
go test ./internal/config -count=1
go test ./cmd/nimi -count=1

cd apps/desktop/src-tauri
cargo test runtime_bridge::daemon_manager::tests
```

## 6. Change Policy

1. `MUST`：Schema 仅允许向后兼容新增字段。
2. `MUST`：破坏性变更必须提升 `schemaVersion` 并提供 `nimi config migrate` 升级路径。
3. `MUST`：新增 provider 时同步更新以下内容：
   1. Schema 与 `runtime/config.example.json`。
   2. env 绑定与别名规则。
   3. 默认值与文档矩阵。
   4. runtime/cli/desktop 测试。
4. `SHOULD`：SSOT 变更先于实现变更提交，避免反向定义合同。
