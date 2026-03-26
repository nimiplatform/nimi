# Runtime Config Domain Spec

> Scope: Runtime 配置读取、路径约束、生效语义与跨端调用边界。
> Normative Imports: `spec/runtime/kernel/*`

## 0. 权威导入

- `kernel/config-contract.md`（路径/优先级：K-CFG-001~002；schema/provider canonicalization：K-CFG-003~004；secret/write：K-CFG-005~006；command surface/validation：K-CFG-007~008；provider env：K-CFG-009；hot reload/credential plane：K-CFG-010~011；defaults/projection：K-CFG-012~013, K-CFG-017；migration：K-CFG-014~016）
- `kernel/local-engine-contract.md`（K-LENG-004）
- `kernel/daemon-lifecycle.md`（K-DAEMON-002, K-DAEMON-009）
- `kernel/provider-health-contract.md`（K-PROV-005）
- `kernel/error-model.md`（K-ERR-001）

## 1. 文档定位

本文件是 runtime-config 主题导引。配置字段定义、优先级、默认值与错误语义以 kernel 为准；当前 first-run targeting 依赖 `defaultLocalTextModel`、`defaultCloudProvider` 与 provider-scoped `defaultModel` / catalog `default_text_model` 的组合语义。

## 2. 关键阅读路径

1. 配置主合同：`kernel/config-contract.md`。
2. supervised engine 与 engine-first 本地执行合同：`kernel/local-engine-contract.md`。
3. daemon 配置装配：`kernel/daemon-lifecycle.md`。
4. provider 命名约束：`kernel/provider-health-contract.md`。
5. 错误映射：`kernel/error-model.md`。
6. schema version 与 provider name canonicalization：`kernel/config-contract.md`（K-CFG-003, K-CFG-004）。
7. runtime command surface、validation、hot reload 与 credential plane：`kernel/config-contract.md`（K-CFG-007~011）。
8. default value governance、cross-layer projection 与 Phase 1 field authority：`kernel/config-contract.md`（K-CFG-012~013, K-CFG-017）。
9. migration framework、执行语义与备份/drift 边界：`kernel/config-contract.md`（K-CFG-014~016）。

## 3. 模块映射

- Runtime 解析与合并：`runtime/internal/config/`。
- CLI 配置入口：`runtime/cmd/nimi/`。
- Desktop 调用桥：`apps/desktop/src-tauri/src/runtime_bridge/`。

## 4. 非目标

- 不在 domain 层定义配置 schema 细节。
- 不在本文件记录执行态门禁结果。

## 5. Hard-Cut Baseline

本地 runtime public config 的 engine-first hard-cut 以 kernel 为准，不在本文件重复规则正文。阅读锚点：

- public config 允许面与 legacy hard-cut：`kernel/config-contract.md`（K-CFG-003~004, K-CFG-014~017）
- 本地引擎 public config 组织与优先级：`kernel/local-engine-contract.md`（K-LENG-008）
- local provider health / loopback env 与 fallback 驱动边界：`kernel/provider-health-contract.md`（K-PROV-002~003）
