# dev/plan 全量审计报告（严格逐条一致）

- 日期：2026-02-27
- 仓库：`/Users/snwozy/nimi-realm/nimi`
- 审计口径：逐条严格一致（plan 文本项必须具备实现与证据）
- 基线说明：
  - `dev/plan/PLAN.md` 在当前工作区为删除状态，按“用户在途变更”处理，未恢复。
  - 审计与实施过程中存在多处非本次范围文件改动，已按“忽略并继续”策略排除。

## 1. 审计范围

1. `dev/plan/R5-Runtime-Strict Fail-Close.md`
2. `dev/plan/R6-S6-localruntime-provider-hints-closure.md`
3. `dev/plan/Runtime-Config-SSOT.md`
4. `dev/plan/runtime-config-ssot-implementation-gap-2026-02-27.md`
5. `dev/plan/sdk-vnext-typescript-interface-spec-2026-02-27.md`
6. `dev/plan/sdk-vnext-user-centric-implementation-plan-2026-02-27.md`
7. `dev/plan/README.md`
8. `dev/plan/PLAN.md`（当前工作区删除，纳入基线记录）

## 2. 状态矩阵（逐文件）

| 文件 | 状态 | 结论 | 证据锚点 |
|---|---|---|---|
| `R5-Runtime-Strict Fail-Close.md` | DONE | proto/runtime/workflow/sdk/门禁闭环已落地 | `dev/report/runtime-multimodal-r5-2026-02-26.md`、`runtime/internal/services/ai/media_job_methods.go`、`runtime/internal/services/workflow/executor.go` |
| `R6-S6-localruntime-provider-hints-closure.md` | DONE | localruntime provider hints 与 nexa npu gate 已落地 | `runtime/internal/services/localruntime/service.go`、`runtime/internal/services/localruntime/service_test.go` |
| `Runtime-Config-SSOT.md` | DONE | SSOT 文档、实现链路、验证命令均已闭环 | `ssot/runtime/config-contract.md`、`dev/report/runtime-config-ssot-implementation-2026-02-27.evidence.md` |
| `runtime-config-ssot-implementation-gap-2026-02-27.md` | DONE | 本轮补齐并发写冲突测试、daemon 启动链迁移测试、restart 提示状态回写 | `runtime/cmd/nimi/config_commands_test.go`、`runtime/internal/entrypoint/runtime_config_startup_chain_test.go`、`apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller.ts` |
| `sdk-vnext-typescript-interface-spec-2026-02-27.md` | DONE | bridge helper types / pure helpers 已落地并导出 | `sdk/src/runtime/vnext-types.ts`、`sdk/src/runtime/runtime-realm-bridge.ts`、`sdk/src/runtime/index.ts` |
| `sdk-vnext-user-centric-implementation-plan-2026-02-27.md` | DONE | Slice C 的 helper types 要求已落地并在计划文档回写 | `sdk/src/runtime/vnext-types.ts`、`sdk/test/integration/runtime-realm-bridge-helpers.test.ts` |
| `README.md` | DONE | 目录说明文档，无执行项 | `dev/plan/README.md` |
| `PLAN.md`（已删除） | BASELINE | 删除状态按用户在途变更记录，不作为本轮整改对象 | `git status --short`（审计基线） |

## 3. 本轮补缺口实施项

1. Runtime Config 写锁可测试 hook（仅测试用途）  
   - 代码：`runtime/cmd/nimi/config_commands.go`
2. CLI `set` 并发冲突集成测试  
   - 用例：`TestRunRuntimeConfigSetConcurrentWriteConflict`  
   - 代码：`runtime/cmd/nimi/config_commands_test.go`
3. daemon 启动链迁移集成测试  
   - 用例：`TestRunDaemonFromArgsMigratesLegacyRuntimeConfigOnStartup`  
   - 代码：`runtime/internal/entrypoint/runtime_config_startup_chain_test.go`
4. SDK bridge helper types + pure helpers  
   - 类型：`RuntimeAuthMaterial`、`RuntimeRealmBridgeContext`、`RuntimeRealmBridgeHelpers`、`NimiErrorCode`  
   - 代码：`sdk/src/runtime/vnext-types.ts`、`sdk/src/runtime/runtime-realm-bridge.ts`、`sdk/src/types/index.ts`
5. SDK 文档与测试补齐  
   - 文档：`docs/sdk/README.md`  
   - 测试：`sdk/test/integration/runtime-realm-bridge-helpers.test.ts`
6. plan 文档状态回写  
   - `dev/plan/runtime-config-ssot-implementation-gap-2026-02-27.md`  
   - `dev/plan/sdk-vnext-typescript-interface-spec-2026-02-27.md`  
   - `dev/plan/sdk-vnext-user-centric-implementation-plan-2026-02-27.md`

## 4. 验证命令结果

### 4.1 计划要求全量命令

1. `cd proto && ../scripts/run-buf.sh lint`：PASS
2. `cd proto && ../scripts/run-buf.sh breaking --against ../runtime/proto/runtime-v1.baseline.binpb`：PASS
3. `cd proto && ../scripts/run-buf.sh generate`：PASS
4. `cd runtime && go test ./internal/services/ai ./internal/services/workflow ./internal/services/localruntime ./internal/daemon ./internal/httpserver ./internal/entrypoint ./cmd/nimi -count=1`：PASS
5. `pnpm check:runtime-go-coverage`：PASS（total 67.7%）
6. `pnpm check:runtime-ai-media-coverage`：PASS（ai 73.0%，核心函数门槛全部通过）
7. `cd runtime && go run ./cmd/runtime-compliance --gate`：PASS（23/23）
8. `pnpm --filter @nimiplatform/sdk lint`：PASS
9. `pnpm --filter @nimiplatform/sdk test`：PASS
10. `pnpm check:sdk-vnext-matrix`：PASS
11. `pnpm check:sdk-coverage`：PASS（lines 91.92 / branches 73.64 / functions 94.32）
12. `pnpm check:sdk-consumer-smoke`：PASS
13. `pnpm check:no-create-nimi-client`：PASS
14. `pnpm check:no-global-openapi-config`：PASS
15. `pnpm check:no-openapi-singleton-import`：PASS
16. `pnpm check:ssot-frontmatter && pnpm check:ssot-links && pnpm check:ssot-traceability`：PASS

### 4.2 备注（可复现波动）

1. 在“整批串行执行”场景下，`pnpm check:sdk-coverage` 曾出现一次 `realm-client.test.ts` 挂起取消（`Promise resolution is still pending...`）。
2. 单独重跑同命令后通过，作为最终验收结果记录。

## 5. 结论

1. `dev/plan` 审计范围内的执行项已按“逐条严格一致”闭环。
2. 本轮识别缺口（SDK bridge helper types、Runtime Config 两类测试、plan 文档滞后）已全部补齐并通过门禁复验。
3. 新增审计报告与代码/测试/文档状态一致，缺口清单已清零。
