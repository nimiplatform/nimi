# SDK Testing Gates Domain Spec

> Status: Active
> Date: 2026-03-01
> Scope: SDK 测试层次、覆盖率门禁、合同边界门禁、provider 兼容矩阵、vNext 矩阵。
> Normative Imports: `spec/sdk/kernel/*`

## 0. 权威导入

本文件不再重复定义跨域通用契约，统一导入 kernel 规则：

- SDK 子路径与导出面：`kernel/surface-contract.md`（`S-SURFACE-*`）
- 传输模型：`kernel/transport-contract.md`（`S-TRANSPORT-*`）
- 错误投影：`kernel/error-projection.md`（`S-ERROR-*`）
- 导入边界：`kernel/boundary-contract.md`（`S-BOUNDARY-*`）

## 1. 领域不变量

`SDKTEST-*` 为 SDK 测试门禁领域增量规则（非 kernel 通用规则）。

- `SDKTEST-001`: 文档中声明的"已支持"能力必须有对应测试文件或门禁命令。
- `SDKTEST-002`: 覆盖率门禁与契约门禁必须可在仓库内复现。
- `SDKTEST-003`: provider 兼容性结论必须区分 fake-server contract 与 live smoke。
- `SDKTEST-004`: vNext 收口能力必须通过固定矩阵门禁验证，不允许只靠局部测试证明。

## 2. 测试层次

### 2.1 单元/模块测试

命令：`pnpm --filter @nimiplatform/sdk test`

- `SDKTEST-010`: 主要覆盖范围：client 初始化与 scope 绑定、runtime transport/metadata/错误归一化/method parity（对齐 `S-TRANSPORT-001` 显式 transport 声明与 `S-ERROR-001` 双层错误投影）、workflow builder、ai-provider 映射与多模态封装、realm facade 命名规范与实例隔离（对齐 `S-SURFACE-004` realm 实例化 facade）、mod 注入路径、runtime+realm 编排范式。

### 2.2 覆盖率门禁

命令：`pnpm check:sdk-coverage`

- `SDKTEST-020`: 阈值：lines >= 90、branches >= 70、functions >= 90。

### 2.3 合同与边界门禁

- `SDKTEST-030`: 必须执行的边界检查命令（对齐 `S-BOUNDARY-*`）：
  1. `pnpm check:sdk-import-boundary`（`S-BOUNDARY-001` 子路径导入边界）
  2. `pnpm check:sdk-single-package-layout`
  3. `pnpm check:sdk-public-naming`（`S-SURFACE-003` 禁用旧接口名）
  4. `pnpm check:reason-code-constants`（`S-ERROR-002` ReasonCode 事实源）
  5. `pnpm check:scope-catalog-drift`
  6. `pnpm check:runtime-bridge-method-drift`（`S-SURFACE-002` 方法投影对齐）
  7. `pnpm check:sdk-version-matrix`
  8. `pnpm check:sdk-consumer-smoke`
  9. `pnpm check:no-create-nimi-client`（`S-BOUNDARY-004` 禁止旧入口）
  10. `pnpm check:no-global-openapi-config`（`S-BOUNDARY-004` 禁止全局配置）
  11. `pnpm check:no-openapi-singleton-import`
  12. `pnpm check:sdk-realm-legacy-clean`（`S-SURFACE-005` realm 公开符号去 legacy）

### 2.4 vNext 固定矩阵门禁

命令：`pnpm check:sdk-vnext-matrix`

- `SDKTEST-040`: 固定测试集：
  1. `sdk/test/runtime/runtime-bridge-method-parity.test.ts`
  2. `sdk/test/realm/realm-client.test.ts`
  3. `sdk/test/scope/module.test.ts`
  4. `sdk/test/ai-provider/provider.test.ts`
  5. `sdk/test/mod/mod-runtime-context.test.ts`
  6. `sdk/test/integration/runtime-realm-orchestration.test.ts`

### 2.5 PR/Release 同级门禁

- `SDKTEST-050`: PR CI 必须执行 legacy/OpenAPI 禁令与 `sdk-vnext-matrix`。
- `SDKTEST-051`: SDK release workflow 必须在 publish 前执行同级检查，不得降级或绕过。
- `SDKTEST-052`: 发布判定采用 `CI+条件Live`：当 `NIMI_SDK_LIVE` 或 provider 环境变量缺失时，发布状态记为 `CONDITIONAL_READY`；若 live 环境齐全但任一 live smoke 失败，则记为 `NOT_READY`。

## 3. Runtime 契约测试

前置：`NIMI_RUNTIME_CONTRACT=1`

- `SDKTEST-060`: 覆盖文件：`sdk/test/runtime/contract/**/*.test.ts`。
- `SDKTEST-061`: 覆盖能力：runtime daemon 实连（workflow submit/get、localRuntime 调用）、ai-provider 与 runtime 实链路文本/流式（对齐 `S-TRANSPORT-003` 流式行为边界）、各 provider adapter 的多模态适配行为。

## 4. Provider 兼容矩阵

- `SDKTEST-070`: Provider 兼容矩阵门禁规则：
  - 矩阵结构：Provider × Capability（Text/Embedding/Image/Video/TTS/STT），结果为 Yes / Fail-Close / `-`（未覆盖）。
  - Provider 名称集合必须与 `spec/runtime/kernel/tables/provider-catalog.yaml` 对齐（或维护显式名称映射表）。
  - 矩阵数据为执行态快照，维护在 `dev/report/sdk-provider-compatibility.md`。
- `SDKTEST-071`: Fail-Close 场景必须返回结构化错误（对齐 `S-ERROR-001` 双层错误投影）。

## 5. Live Smoke

前置：`NIMI_SDK_LIVE=1` + 对应环境变量。

- `SDKTEST-080`: 覆盖文件：`nimi-sdk-ai-provider-live-smoke.test.ts`。
- `SDKTEST-081`: 当前场景：local provider 真实服务文本生成、nimiLLM 真实服务文本生成。
- `SDKTEST-082`: 当 live 测试因环境变量缺失而跳过时，必须在发布审计报告中记录跳过原因与缺失变量列表（对应 `SDKTEST-052` 条件发布判定）。

## 6. 已知测试边界

- `SDKTEST-090`: realm 已覆盖实例隔离与关键错误映射，但未覆盖每一个 realm endpoint 的行为契约（对齐 `S-SURFACE-004` realm/scope/mod 稳定导出面说明）。
- `SDKTEST-091`: provider contract 主要由 fake server + runtime daemon 组合验证，live smoke 仍是抽样覆盖。

## 7. 本文件非目标

- 不定义 SDK 子路径集合（见 kernel `S-SURFACE-001`）
- 不定义 runtime transport 声明（见 kernel `S-TRANSPORT-001`）
- 不定义 ReasonCode 事实源（见 kernel `S-ERROR-002`）
- 不定义导入边界规则（见 kernel `S-BOUNDARY-*`）

## 8. 变更规则

修改 SDK 测试门禁时必须同时满足：

1. 若触及 SDK 子路径或导出面规则，先改 `spec/sdk/kernel/surface-contract.md`
2. 若触及边界规则，先改 `spec/sdk/kernel/boundary-contract.md`
3. 再改本文件的领域增量规则
4. 禁止在本文件新增 kernel 规则副本
