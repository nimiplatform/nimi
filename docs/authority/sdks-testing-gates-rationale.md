# SDKs Testing Gates - Rationale

> 本文为旧格式 SDK testing-gates 契约的整文存档，非规范权威；测试纪律语义由 `.nimi/spec/platform/testing-discipline.authority.yaml` 与 `.nimi/spec/platform/admission.authority.yaml` 覆盖，SDK 产品边界语义由 `.nimi/spec/sdks/*.authority.yaml` 覆盖。原文件按准入标准（④类：门禁分层/命令注册表为流程配置，非产品权威）拒绝迁移并删除。

---

<!-- source: .nimi/spec/sdks/kernel/testing-gates-contract.md -->

# SDK Testing Gates Contract

> Owner Domain: `S-GATE-*`

## S-GATE-001 Layered Test Policy

SDK 门禁分层：单元/模块、consumer smoke、合同/边界、runtime 投影、release contract composition、覆盖率、adapter 对齐、live smoke、发布一致性。

## S-GATE-010 Unit, Module & Consumer Baseline

关键子路径必须有单元与模块级测试基线；打包后的公开子路径必须可被独立消费者安装并导入。

执行命令：

- `pnpm --filter @nimiplatform/sdk test`
- `pnpm check:sdk-consumer-smoke`

## S-GATE-020 Contract & Boundary Gate

导入边界、公开命名、旧入口回流禁止、ReasonCode 常量完整性、单包布局与
AI-runner-facing export authority posture 必须通过一致性检查。

执行命令：

- `pnpm check:sdk-vnext-package-contract`
- `pnpm check:sdk-vnext-public-surface-smoke`
- `pnpm check:sdk-root-entry-contract`
- `pnpm check:no-global-openapi-config`
- `pnpm check:sdk-vnext-realm-consumer-smoke`
- `pnpm check:reason-code-constants`
- `pnpm check:sdk-vnext-runtime-facade`
- `pnpm check:sdk-ai-runner-export-posture`
- `pnpm check:sdk-doctor`

AI-runner-facing 公开 export 的 authority posture 必须与
`tables/ai-runner-export-authority-posture.yaml` 注册表一致：enforced coverage
root 下每个公开符号必须声明 `runtime-projection`、
`ephemeral-client-orchestration`、`pure-sugar` 三类之一；`runtime-projection`
必须携带可解析的 `authority_ref`。新增公开 export 未登记 posture 时该 gate
必须失败。

`tables/framework-api-capability-map.yaml` 中每个 capability 引用必须 verbatim
解析到对应 adapter 在 `tables/typescript-adapter-capability-ledger.yaml` 的
`capability_claims`；`check:sdk-doctor` 套件承载该一致性断言，map 与 ledger
漂移时必须失败。

## S-GATE-030 Release Contract Composition Gate

SDK release contract gate 必须只组合尚未由其他 release gate 执行的
boundary、external-consumer、adapter、proof、doctor 与 hardcut 检查。它必须在
同一个 SDK distribution lock 内只准备一次 SDK build；各 leaf 命令独立执行时
仍必须自包含并 fail closed。

完整 SDK 测试与 build 由 coverage gate 承载；generator drift、typed-core
conformance、packaged consumer smoke 与 version parity 保持独立边界。release
contract composition 不得再次运行这些 suite/gate。

执行命令：

- `pnpm check:sdk-release-contracts`

## S-GATE-040 App And Permission Scope Gate

App and permission scope surfaces must pass boundary and semantic regression
checks without restoring removed `scope` subpaths.

执行命令：

- `pnpm check:sdk-vnext-package-contract`
- `pnpm check:sdk-consumer-smoke`

## S-GATE-050 Runtime Projection Gate

runtime 子路径对 RPC 投影与 phase 状态必须一致。

## S-GATE-060 Coverage Gate

SDK 覆盖率必须达到项目设定阈值。

## S-GATE-070 Runtime Provider Catalog Alignment Gate

Runtime provider/model catalog names consumed by SDK and adapters must align
with Runtime catalog truth.

执行命令：

- `pnpm check:live-provider-invariants`

## S-GATE-080 Live Smoke Gate

live smoke 在配置完整时必须可运行并给出可审计结果。

执行命令：

- `node scripts/run-live-test-matrix.mjs`
- `pnpm check:live-smoke-gate`

## S-GATE-090 Release Parity Gate

PR 与 release 的门禁策略保持同级，不允许 release 专属降级；SDK 包元数据/版本矩阵必须在发布前保持一致。

执行命令（release 前硬阻断）：

- `pnpm check:sdk-version-matrix`
- `pnpm check:live-smoke-gate --require-release`

## S-GATE-091 Docs Drift Gate

spec kernel consistency 与 docs drift 必须同时通过。

CI 一致性守护额外检查：

- SDKS spec 与 Runtime spec 的交叉引用一致性：确认所有 `S-*` 规则引用的 `K-*` rule ID 存在于 `spec/runtime` 中。
- Runtime SDK 职责覆盖：确认 `spec/runtime` 中明确指派 SDK 职责的规则在 `spec/sdks` 中有对应投影。

执行命令：

- `pnpm exec nimicoding validate-spec-governance --profile nimi --scope sdks-consistency`
- `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope sdks --check`

## S-GATE-092 SDKS Core Family Conformance Admission

`sdks/` core-family conformance is a release blocker only through admitted
`sdks/conformance` runners. The SDK spec must not list fake runnable
conformance commands, and release gate tables must not imply that
cross-language conformance exists without admitted runners.

Admitted conformance must be language-neutral for shared semantics and
language-specific only at the harness binding layer. It must cover Runtime and
Realm together for each core language: TypeScript, Python, Go, and Rust.

The TypeScript package gates are runnable SDK gates only. They do not prove
Python/Go/Rust generated core readiness and must not be used as a substitute
for core-family conformance.
