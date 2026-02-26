# Runtime 多模态 G3+G5 证据记录 R4

- 日期：2026-02-26
- 目标：提供可复现的命令证据，支撑 `dev/report/runtime-multimodal-g3-g5-matrix-2026-02-26-r4.md`

## 1. 覆盖率门禁

1. `pnpm check:runtime-go-coverage`
   - scope: `./internal/services/...`
   - 结果：`total statements coverage: 66.0%`
2. `pnpm check:runtime-ai-media-coverage`
   - `ai package statements coverage: 72.9%`
   - `SubmitMediaJob: 81.5%`
   - `GetMediaJob: 100.0%`
   - `CancelMediaJob: 100.0%`
   - `SubscribeMediaJobEvents: 81.0%`
   - `GetMediaArtifacts: 100.0%`

## 2. 核心测试命令

1. `cd runtime && go test ./internal/services/ai`
2. `cd runtime && go test ./internal/services/workflow`
3. `cd runtime && go test ./internal/services/localruntime`
4. `cd runtime && go test ./...`
5. `pnpm --filter @nimiplatform/sdk test`

## 3. 合规与协议

1. `pnpm proto:lint`
2. `pnpm proto:breaking`
3. `pnpm proto:generate`
4. `cd runtime && go run ./cmd/runtime-compliance --gate`

以上命令在本轮均执行通过。
