# Runtime Config Contract

> Owner Domain: `K-CFG-*`

## K-CFG-001 Canonical Config Path

Runtime 配置文件唯一 canonical 路径为 `~/.nimi/config.json`。不读取 legacy 路径。

## K-CFG-002 Source Priority

配置来源优先级固定为：环境变量 > 配置文件 > 内置默认值。

## K-CFG-003 Schema Version

配置文件必须包含 `schemaVersion`，当前固定为 `1`。未知字段按向前兼容策略忽略。

## K-CFG-004 Provider Name Canonicalization

配置中的 provider 名称必须使用 `provider-catalog.yaml` 的 canonical 值，alias 与 legacy 名称必须拒绝。

## K-CFG-005 Secret Policy

provider 凭据允许使用 `apiKey` 或 `apiKeyEnv` 之一；两者不得同时设置。user-facing tooling 应优先使用环境变量或系统安全存储，inline `apiKey` 仅作为 canonical config file 的 fallback 形态。

## K-CFG-006 Atomic Write

配置写入必须采用临时文件 + rename 的原子写策略。

## K-CFG-007 Runtime Command Surface

`config init/validate/get/set` 的行为语义必须与本契约一致，错误通过统一 reason code 输出。

## K-CFG-008 Validation Fail-Close

配置校验失败必须 fail-close，不得以部分成功继续启动核心路径。

## K-CFG-009 Provider Env Binding

provider 对应 `baseUrl/apiKey` 的环境变量绑定以 `provider-probe-targets.yaml` 为事实源。

## K-CFG-010 Hot Reload Boundaries

配置变更的热生效与重启生效边界必须显式声明，不允许隐式生效。

## K-CFG-011 Credential Plane Boundary

配置层允许声明凭据引用，也允许在 canonical config file 中保留 fallback inline secret；更高层的安装与配置入口必须优先提供 env / secure-store path。对 public CLI first-run 而言，interactive credential capture 若发生，必须立即把 inline `apiKey` 写入 canonical config，并保持 `apiKey` / `apiKeyEnv` 互斥。

## K-CFG-012 Default Value Governance

默认值必须在 kernel 表格中有可追溯来源，不允许散落在实现层文档。

## K-CFG-013 Cross-Layer Projection

Desktop/CLI/SDK 对 runtime 配置行为的投影必须与本契约保持语义一致。config 允许声明：

- top-level `defaultLocalTextModel`，用于覆盖 bundled local default text target
- top-level `defaultCloudProvider`
- provider-scoped `defaultModel`

其中 machine-default cloud target 由 `defaultCloudProvider + provider.defaultModel` 形成；当 provider 未显式覆盖 `defaultModel` 时，higher-level surface 必须回退到 provider catalog 的 `default_text_model`。`nimi run --cloud`、provider-only high-level CLI/SDK 等 surface 不得绕过这组配置语义。

## K-CFG-014 Schema Migration Framework

`schemaVersion` 不是声明性占位字段，而是迁移入口：

- 每次 `schemaVersion` 递增都必须伴随明确的 migration plan。
- migration plan 必须声明 `from_version`、`to_version`、字段级变更、默认值策略与 fail-close 条件。
- 禁止跨版本隐式“猜测修复”；未知旧字段只能通过显式迁移规则处理。

## K-CFG-015 Migration Execution Semantics

- Runtime 读取到旧 `schemaVersion` 配置时，必须先执行顺序迁移，再允许进入核心服务启动路径。
- 迁移执行必须保持幂等：同一版本配置多次重放迁移，输出结果必须一致。
- 迁移写回必须沿用 `K-CFG-006` 的原子写语义；写回失败时保留旧文件并终止启动。

## K-CFG-016 Migration Backup & Drift Boundary

- 迁移成功写回前，Runtime 必须保留可恢复的 pre-migration backup 或等价回滚材料。
- Desktop/CLI/SDK 只能消费迁移后的 canonical 配置，不得各自实现第二套 schema upgrade 逻辑。
- 配置迁移规则进入 kernel 后，相关 default 值、热重载边界与 command surface 必须同步更新，禁止出现“schema 已升级但投影仍停留旧版本”的漂移。
