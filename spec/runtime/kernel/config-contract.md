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

配置文件禁止明文密钥字段；仅允许 `apiKeyEnv` 引用环境变量名。

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

配置层只声明凭据引用，不承担凭据明文托管职责。

## K-CFG-012 Default Value Governance

默认值必须在 kernel 表格中有可追溯来源，不允许散落在实现层文档。

## K-CFG-013 Cross-Layer Projection

Desktop/CLI/SDK 对 runtime 配置行为的投影必须与本契约保持语义一致。
