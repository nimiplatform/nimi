# Runtime Config Domain Spec

> Status: Active
> Date: 2026-03-01
> Scope: Runtime 配置路径解析、daemon-config 与 request-credential 平面分离、provider 命名与 env 绑定。
> Normative Imports: `spec/runtime/kernel/*`

## 0. 权威导入

本文件不再重复定义跨域通用契约，统一导入 kernel 规则：

- Daemon 生命周期与配置：`kernel/daemon-lifecycle.md`（`K-DAEMON-*`）
- RPC 面：`kernel/rpc-surface.md`（`K-RPC-*`）
- Provider 健康与命名：`kernel/provider-health-contract.md`（`K-PROV-*`）
- 错误模型：`kernel/error-model.md`（`K-ERR-*`）

## 1. 领域不变量

`CFG-*` 为 Config 领域增量规则（非 kernel 通用规则）。

- `CFG-001`: Runtime Config 是 runtime 启动、provider 连接、CLI/desktop 配置交互的唯一配置真相。
- `CFG-002`: 配置写入主权固定由 `nimi-cli` 持有；desktop 仅通过 tauri bridge 调用 CLI。
- `CFG-003`: `daemon-config plane` 的配置变更采用 restart required 语义（对齐 `K-DAEMON-002` 启动序列）；禁止运行中热加载。

## 2. 路径解析与迁移

- `CFG-010`: 路径解析顺序固定为 `NIMI_RUNTIME_CONFIG_PATH` -> `~/.nimi/config.json`。
- `CFG-011`: 默认路径从 `~/.nimi/runtime/config.json` 切换到 `~/.nimi/config.json`。
- `CFG-012`: 自动迁移仅在以下条件同时满足时触发：未显式设置 env、新路径不存在、旧路径存在。
- `CFG-013`: 迁移后执行硬切换（旧路径删除）；runtime 后续仅识别新路径。
- `CFG-014`: 迁移写入采用原子替换，避免中间态脏文件。

## 3. 优先级与生效语义

- `CFG-020`: 优先级固定为 `CLI flags > ENV > config file > built-in defaults`（对齐 `K-DAEMON-009` 配置解析多源合并）。
- `CFG-021`: `daemon-config plane` 配置修改后必须重启 runtime 生效（`restart required`）。
- `CFG-022`: runtime 不得 watch 配置文件并进行热加载。

## 4. Schema 与默认值

- `CFG-030`: 配置顶层包含 `schemaVersion`，当前固定值为 `1`（对齐 `K-DAEMON-009` 配置表）。
- `CFG-031`: 默认值以 `K-DAEMON-009` 配置表为权威：`grpcAddr=127.0.0.1:46371`、`httpAddr=127.0.0.1:46372`、`shutdownTimeout=10s`。

领域补充默认值（不在 kernel 配置表中）：

| Key | Default |
|---|---|
| `ai.httpTimeout` | `30s` |
| `ai.healthInterval` | `8s`（对齐 `K-PROV-003` 基础探测间隔） |

## 5. Provider 命名与 Env 绑定

- `CFG-040`: provider 配置项以 `ai.providers.<provider>` 表达，归一化规则以 `K-PROV-005`（provider 名称归一化）为权威。
- `CFG-041`: 遗留名称（`litellm`/`cloudlitellm`/`cloudai`）在配置校验时拒绝（对齐 `K-PROV-005` 遗留名称拒绝）。
- `CFG-042`: provider API key 来源通过 `apiKeyEnv` 绑定到环境变量。
- `CFG-043`: Gemini 保留 key alias：当 `NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY` 为空时可回退 `GEMINI_API_KEY`（对齐 `K-PROV-005` Gemini 隐式默认）。

## 6. Secret Policy

- `CFG-050`: 配置文件不得出现明文字段 `apiKey`。
- `CFG-051`: `ai.providers.*.apiKeyEnv` 为必填。
- `CFG-052`: 预留 `secretRef` 扩展位用于后续 vault 接入。

## 7. 写入合同

- `CFG-060`: 仅 `nimi config set` 允许写 Runtime Config。
- `CFG-061`: 写入路径执行文件锁，冲突时返回 `CONFIG_WRITE_LOCKED`。
- `CFG-062`: 写入执行顺序固定为 `parse -> validate -> atomic write`。
- `CFG-063`: desktop 写入通过 tauri command 调 CLI，不直接写配置文件。

## 8. 凭证平面

- `CFG-070`: 区分 `daemon-config plane`（`apiKeyEnv` 驱动，服务于 runtime 进程配置读取）与 `request-credential plane`（受信宿主请求期注入 provider secret）。
- `CFG-071`: `restart required` 仅适用于 `daemon-config plane`，不适用于 `request-credential plane` 的密钥轮换。
- `CFG-072`: 请求显式携带请求期凭证时，执行面必须优先使用该凭证，不得静默回落到 daemon 启动时凭证。
- `CFG-073`: Runtime Config 文件不得持久化明文请求期 secret。
- `CFG-074`: `connectorId -> secret` 解析由 desktop/host 侧负责，runtime 仅消费请求中已注入的 provider secret 与 endpoint 参数。

## 9. 失败语义

| reasonCode | actionHint |
|---|---|
| `CONFIG_PARSE_FAILED` | 运行 `nimi config validate` 并修复 JSON/字段格式 |
| `CONFIG_SCHEMA_INVALID` | 修复 schemaVersion/必填字段后重试 |
| `CONFIG_MIGRATION_FAILED` | 运行 `nimi config migrate` 并检查路径权限 |
| `CONFIG_WRITE_LOCKED` | 等待其他写操作完成后重试 `nimi config set` |
| `CONFIG_SECRET_POLICY_VIOLATION` | 移除明文 apiKey，改为 apiKeyEnv/secretRef |
| `CONFIG_RESTART_REQUIRED` | 重启 runtime 使配置生效 |

- `CFG-080`: CLI 与 desktop bridge 返回错误时携带可识别 `reasonCode`（对齐 `K-ERR-*` 错误模型）。
- `CFG-081`: 每个 `reasonCode` 对应可执行 `actionHint`。

## 10. 验收门禁

验证命令：

```bash
cd runtime
go test ./internal/config -count=1
go test ./cmd/nimi -count=1

cd apps/desktop/src-tauri
cargo test runtime_bridge::daemon_manager::tests
```

- `CFG-090`: runtime 单测必须覆盖迁移、优先级、默认值、provider env 映射、secret policy。
- `CFG-091`: nimi-cli 单测必须覆盖 `init|get|set|validate|migrate` 全子命令。
- `CFG-092`: desktop tauri 单测必须覆盖新路径读取、CLI 写入调用、错误冒泡。

## 11. 变更策略

- `CFG-100`: Schema 仅允许向后兼容新增字段。
- `CFG-101`: 破坏性变更必须提升 `schemaVersion` 并提供 `nimi config migrate` 升级路径。
- `CFG-102`: 新增 provider 时同步更新 schema、env 绑定与别名规则、默认值、runtime/cli/desktop 测试（对齐 `K-PROV-005` provider 名称归一化）。

## 12. 本文件非目标

- 不定义 daemon 健康状态机（见 kernel `K-DAEMON-001`）
- 不定义 daemon 启动序列（见 kernel `K-DAEMON-002`）
- 不定义配置多源合并优先级的完整实现（见 kernel `K-DAEMON-009`）
- 不定义 provider 健康探测策略（见 kernel `K-PROV-003`）

## 13. 变更规则

修改 config 领域时必须同时满足：

1. 若触及 daemon 配置解析规则，先改 `spec/runtime/kernel/daemon-lifecycle.md`
2. 若触及 provider 命名规则，先改 `spec/runtime/kernel/provider-health-contract.md`
3. 再改本文件的领域增量规则
4. 禁止在本文件新增 kernel 规则副本
