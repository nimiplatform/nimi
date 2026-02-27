# dev/plan 全量审计与严格闭环计划（2026-02-27）

## 摘要
1. 已完成只读审计范围：`dev/plan/*.md`（含当前工作区中被删除的 `dev/plan/PLAN.md`）与对应 `dev/report/*`、实现代码、门禁命令。
2. 当前“已执行到位并符合预期”的计划：R5 strict fail-close、R6-S6 provider hints、Runtime Config SSOT 主链路、SDK vNext 主链路（Runtime/Realm 双客户端、无 `createNimiClient`、无 OpenAPI 全局单例）。
3. 按“逐条严格一致”口径仍有缺口：
4. SDK 计划中声明的 bridge helper types 未落地（`RuntimeRealmBridgeContext` / `RuntimeRealmBridgeHelpers` / `RuntimeAuthMaterial`）。
5. Runtime Config gap 文档仍保留 2 个“后续动作”未闭环测试（daemon 启动链迁移集成测试、CLI set 真实并发场景测试）。
6. Runtime Config gap 文档中的“restart 提示后续迭代”已在实现中完成，但文档未回写状态。
7. 本计划目标：一次性补齐以上缺口，并同步 `dev/plan` 与 `dev/report`，使“计划文本、实现、测试、证据”四者一致。

## 公开 API / 接口 / 类型变更
1. 在 SDK 新增并导出 bridge helper 类型（非 breaking）：`RuntimeRealmBridgeContext`、`RuntimeRealmBridgeHelpers`、`RuntimeAuthMaterial`、`NimiErrorCode`（定义为 `keyof typeof ReasonCode`）。
2. 在 SDK 新增纯函数 helper（非聚合客户端）：`buildRuntimeAuthMetadata`、`linkRuntimeTraceToRealmWrite`，保持“显式值传递”编排模型。
3. 不新增第三客户端对象，不恢复 `createNimiClient`，不引入全局 OpenAPI 状态。

## 实施步骤（决策完成，可直接执行）
1. 先落审计结果文档并冻结基线。  
文件：新增 [dev/report/dev-plan-audit-2026-02-27.md](/Users/snwozy/nimi-realm/nimi/dev/report/dev-plan-audit-2026-02-27.md)。  
内容：逐文件状态矩阵（DONE/PARTIAL）、命令复验结果、缺口列表、证据锚点、残余风险。  
规则：仅写执行态证据，不写规范条款。

2. 修复 Runtime Config 剩余缺口并补测试。  
文件：  
[config_commands.go](/Users/snwozy/nimi-realm/nimi/runtime/cmd/nimi/config_commands.go)、  
[config_commands_test.go](/Users/snwozy/nimi-realm/nimi/runtime/cmd/nimi/config_commands_test.go)、  
新增 [runtime_config_startup_chain_test.go](/Users/snwozy/nimi-realm/nimi/runtime/internal/entrypoint/runtime_config_startup_chain_test.go)。  
动作：  
实现可测试的写锁临界区 hook（仅测试使用，默认 nil，无运行时行为变化）。  
新增“CLI set 并发冲突”集成测试：同一路径并发写，断言至少一方返回 `CONFIG_WRITE_LOCKED` 且最终配置 JSON 合法。  
新增“daemon 启动链迁移”集成测试：仅旧路径存在时，经 `RunDaemonFromArgs` 启动入口触发 `config.Load()` 后完成迁移与硬切换。  
验收：两类测试稳定通过，不引入 flaky。

3. 补齐 SDK vNext 计划声明的 bridge helper types。  
文件：  
[vnext-types.ts](/Users/snwozy/nimi-realm/nimi/sdk/src/runtime/vnext-types.ts)、  
新增 [runtime-realm-bridge.ts](/Users/snwozy/nimi-realm/nimi/sdk/src/runtime/runtime-realm-bridge.ts)、  
[index.ts](/Users/snwozy/nimi-realm/nimi/sdk/src/runtime/index.ts)、  
[index.ts](/Users/snwozy/nimi-realm/nimi/sdk/src/index.ts)、  
[README.md](/Users/snwozy/nimi-realm/nimi/docs/sdk/README.md)、  
新增测试 [runtime-realm-bridge-helpers.test.ts](/Users/snwozy/nimi-realm/nimi/sdk/test/integration/runtime-realm-bridge-helpers.test.ts)。  
动作：  
定义并导出 `RuntimeRealmBridgeContext`、`RuntimeRealmBridgeHelpers`、`RuntimeAuthMaterial`、`NimiErrorCode`。  
实现纯 helper 函数并补 A/B/C/D 编排文档示例引用。  
新增类型与行为测试，确保 helper 输出与现有 orchestration tests 一致。

4. 回写 dev/plan 状态，消除“文档滞后”。  
文件：  
[runtime-config-ssot-implementation-gap-2026-02-27.md](/Users/snwozy/nimi-realm/nimi/dev/plan/runtime-config-ssot-implementation-gap-2026-02-27.md)、  
[sdk-vnext-user-centric-implementation-plan-2026-02-27.md](/Users/snwozy/nimi-realm/nimi/dev/plan/sdk-vnext-user-centric-implementation-plan-2026-02-27.md)、  
[sdk-vnext-typescript-interface-spec-2026-02-27.md](/Users/snwozy/nimi-realm/nimi/dev/plan/sdk-vnext-typescript-interface-spec-2026-02-27.md)。  
动作：  
将“restart required UI 提示”从后续项改为已完成并附证据路径。  
将并发/daemon 启动链测试从“动作描述”升级为“已完成+命令+测试锚点”。  
将 bridge helper types 从“计划项”标注为“已实现”并附导出路径。  
`dev/plan/PLAN.md` 默认按“删除是 intentional”处理，不恢复；在审计报告中记录该基线事实。

5. 最终全量门禁复验并归档证据。  
命令集：  
`cd proto && ../scripts/run-buf.sh lint`  
`cd proto && ../scripts/run-buf.sh breaking --against ../runtime/proto/runtime-v1.baseline.binpb`  
`cd proto && ../scripts/run-buf.sh generate`  
`cd runtime && go test ./internal/services/ai ./internal/services/workflow ./internal/services/localruntime ./internal/daemon ./internal/httpserver ./internal/entrypoint ./cmd/nimi -count=1`  
`pnpm check:runtime-go-coverage`  
`pnpm check:runtime-ai-media-coverage`  
`cd runtime && go run ./cmd/runtime-compliance --gate`  
`pnpm --filter @nimiplatform/sdk lint`  
`pnpm --filter @nimiplatform/sdk test`  
`pnpm check:sdk-vnext-matrix`  
`pnpm check:sdk-coverage`  
`pnpm check:sdk-consumer-smoke`  
`pnpm check:no-create-nimi-client`  
`pnpm check:no-global-openapi-config`  
`pnpm check:no-openapi-singleton-import`  
`pnpm check:ssot-frontmatter && pnpm check:ssot-links && pnpm check:ssot-traceability`

## 测试场景与验收标准
1. Runtime Config 并发写场景：并发 `set` 下锁冲突返回 `CONFIG_WRITE_LOCKED`，且配置文件保持可解析与 schema 合法。
2. Runtime Config 启动迁移场景：仅旧路径存在时，启动入口链路触发迁移，新路径生效且旧路径失效。
3. SDK helper types 场景：类型可从包根导入；helper 输出与现有 Pattern A/B/C/D 编排测试一致。
4. 文档一致性场景：`dev/plan` 状态描述与实现/测试/报告三方一致，不存在“已实现但文档仍标后续”的条目。
5. 通过标准：上述命令全部通过，且新增审计报告中的缺口清单清零。

## 假设与默认值
1. 采用你确认的“逐条严格一致”口径，计划文本中的显式条目必须有实现与证据。
2. 当前工作区 `dev/plan/PLAN.md` 删除状态视为你的在途变更，本计划默认不恢复该文件。
3. 不引入新依赖，不改变既有跨组件边界，不做兼容壳回退。
4. 本轮仅收敛已识别缺口，不扩展到新需求范围。
