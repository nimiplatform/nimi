# Runtime 多模态 R5 证据记录（协议完整性 + Strict Fail-Close）

- 日期：2026-02-26
- 范围：`proto/runtime/v1/*`、`runtime/internal/services/ai`、`runtime/internal/services/workflow`、`sdk/src/ai-provider`
- 目标：验证 R5 计划中 G3+G5 对应的协议收敛与门禁通过

## 1. Proto 与生成链路

1. `cd proto && ../scripts/run-buf.sh lint`：PASS
2. `cd proto && ../scripts/run-buf.sh breaking --against ../runtime/proto/runtime-v1.baseline.binpb`：PASS
3. `cd proto && ../scripts/run-buf.sh generate`：PASS（生成产物已更新）

## 2. Runtime/Workflow 测试

1. `cd runtime && go test ./internal/services/ai ./internal/services/workflow ./internal/services/localruntime ./internal/daemon ./internal/httpserver`：PASS
2. `cd runtime && go test ./...`：PASS

## 3. Coverage 门禁

1. `pnpm check:runtime-go-coverage`
   - scope: `./internal/services/...`
   - 结果：`total statements coverage: 66.1%`（门槛 `>=60%`）
2. `pnpm check:runtime-ai-media-coverage`
   - `internal/services/ai`: `71.5%`（门槛 `>=70%`）
   - media core functions:
     - `SubmitMediaJob: 82.9%`
     - `GetMediaJob: 100.0%`
     - `CancelMediaJob: 100.0%`
     - `SubscribeMediaJobEvents: 81.0%`
     - `GetMediaArtifacts: 100.0%`

## 4. SDK 测试

1. `pnpm --filter @nimiplatform/sdk test`：PASS（42/42）
2. 新增断言：
   - `AbortSignal` 触发先 `cancelMediaJob` 再抛错
   - `requestId/idempotencyKey/labels` 透传到 `SubmitMediaJob`

## 5. 合规门禁

1. `cd runtime && go run ./cmd/runtime-compliance --gate`：PASS（23/23）

