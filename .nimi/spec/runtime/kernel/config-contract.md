# Runtime Config Contract

> Owner Domain: `K-CFG-*`

## K-CFG-001 Canonical Config Path

Runtime 配置文件唯一 canonical 路径为 `~/.nimi/runtime/config.json`。
Root-level `~/.nimi/config.json` 不再是 future product authority。读取旧路径
只能作为显式迁移输入，并且不得在迁移后继续作为 fallback truth。

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

已声明的边界：

- `~/.nimi/runtime/config.json`（本契约管辖的 machine config）为重启生效，
  除非某条规则显式另行声明。
- Runtime Agent AI Config（K-AGCORE-144~150）不属于本契约的 machine
  config plane。它经 RuntimeAgentService RPC 持久化于 runtime store，热生效，
  粒度为 next-turn：变更不影响 in-flight turn 的 execution snapshot。

## K-CFG-011 Credential Plane Boundary

配置层允许声明凭据引用，也允许在 canonical config file 中保留 fallback inline secret；更高层的安装与配置入口必须优先提供 env / secure-store path。

对 public CLI first-run 而言，interactive credential capture 若发生，用户粘贴的 provider key 必须立即写入 canonical machine config，使同一条 onboarding `run` 不以“仅本次 inline memory credential”作为成功条件。该路径仍必须提示 inline secret 风险并继续推荐 `apiKeyEnv` / secure-store；写入失败必须 fail-close，不得继续执行 cloud generation。当前 invocation 可继续携带 inline metadata 给已运行 daemon，以避免假定 daemon 已热重载配置，但持久化结果必须以 canonical config 为准。

The top-level `sourceMaterializationPacketHmacSecret` field is Runtime-owned
verifier material for Realm-issued source materialization packet HMAC proofs.
RuntimeAgent may consume only the resolved Runtime config value; Desktop, SDK,
and app callers must not read, derive, or transmit this secret as
materialization payload. Empty verifier material rejects source materialization
fail-closed.

## K-CFG-012 Default Value Governance

默认值必须在 kernel 表格中有可追溯来源，不允许散落在实现层文档。

## K-CFG-013 Cross-Layer Projection

Desktop/CLI/SDK 对 runtime 配置行为的投影必须与本契约保持语义一致。config 允许声明：

- top-level `defaultLocalTextModel`，用于覆盖 bundled local default text target
- top-level `defaultCloudProvider`
- provider-scoped `defaultModel`

其中 machine-default cloud target 由 `defaultCloudProvider + provider.defaultModel`
形成。

- Runtime Agent AI Config alias bindings consume admitted default target
  aliases rather than copying concrete targets into every agent record. The
  default alias family includes `local/default`, capability-specific local
  defaults, `local/default-embedding`, and `cloud/default`.
- Changing a default alias target is an admitted app-facing Runtime config
  mutation surface with explicit scope, audit, and Runtime Agent AI Config
  readiness recompute. Alias-bound agents observe the new target on their next
  turn; pinned agents are unaffected. This package records the authority only;
  implementation of the mutation RPC and Agent Center Model UI is a separate
  follow-up package.

- 对 `static_source` provider：当 provider 未显式覆盖 `defaultModel` 时，
  higher-level surface 可以回退到 provider catalog 的
  `default_text_model`。
- 对 `dynamic_endpoint` provider：higher-level surface 不得回退到 provider
  catalog `default_text_model`。必须使用显式 `provider.defaultModel`，或由
  UI/route 提供 live-selected model；若两者都缺失，runtime 必须 fail-close。

`nimi run --cloud`、provider-only high-level CLI/SDK 等 surface 不得绕过这组
配置语义。

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
- 配置迁移规则进入 kernel 后，相关 default 值、热重载边界与 command surface 必须同步更新，禁止出现”schema 已升级但投影仍停留旧版本”的漂移。

## K-CFG-017 Phase 1 Field Authority

Phase 1 配置文件 `~/.nimi/runtime/config.json` 的权威字段清单由
`tables/config-schema.yaml` 定义。该表包含每个字段的类型、默认值、reload
语义（`restart`/`hot`/`immutable`）与来源规则引用。

配置字段的新增或修改必须先更新 `tables/config-schema.yaml`，再同步相关合约文档。

## K-CFG-018 Data Root Reference And Service Posture Boundary

Runtime config may store `dataRootRef` and derived managed roots for models,
dependencies, environments, logs, and audit. These fields are Runtime-owned
daemon/materialization configuration and must be reconciled from the product
control record selected `nimi_data`.

Runtime config also owns its own daemon identity and service posture:

- `runtimeId` is the stable local Runtime daemon identity. It is generated once
  at config init and is immutable for the lifetime of the config file.
- `localService.enabled` and `localService.mode` declare the Runtime local
  service posture. `localService.mode` is restricted to the closed value
  `desktop-local` for the on-device Phase 1 product.

Runtime config does not own first-run product state, install level, account app
library, account profile library, permission grants, or app durable data.
Conflicts between Runtime config roots and `~/.nimi/nimi.json` selected
`nimi_data` must fail closed into repair/migration rather than silently choosing
one path.

The Runtime page `Environment` surface reads the `nimi_data` data-plane roots
(`models`, `dependencies`, `environments`, `logs`, `audit`) as a Runtime-owned
read-only data model derived from `dataRootRef` and `managedRoots`; it does not
introduce a second config authority.

The data-plane roots are also the only admitted install location for Runtime
local environment materialization. `local-environment-dependencies.yaml` binds
each dependency family to one of these root ids through its `managed_root`
field: `models` for model and companion asset payloads, `dependencies` for
standalone downloaded dependency payloads (the `uv` tool, the shared
accelerator/CUDA runtime), and `environments` for Nimi-managed executable
environment trees (native engine packages, the managed Python interpreter,
venvs, package sets, Torch wheels). The engine manager, native engine package
installers, and Python dependency materializers must resolve their install root
from `dataRootRef` / `managedRoots` and must not use `~/.nimi/engines` or any
other home-directory root. When `dataRootRef` is empty the managed install
fails closed into product setup rather than guessing a path.
