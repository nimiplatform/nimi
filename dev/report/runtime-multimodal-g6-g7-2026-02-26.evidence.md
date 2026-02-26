# Runtime 多模态 G6+G7 门禁证据

- 日期：2026-02-26
- 关联报告：`dev/report/runtime-multimodal-g6-g7-2026-02-26.md`

## 1. G6 证据

1. `cd runtime && go test ./internal/services/audit ./internal/providerhealth ./internal/httpserver ./cmd/nimi`：PASS

## 2. G7 证据

1. `cd runtime && go test ./...`：PASS
2. `cd runtime && go run ./cmd/runtime-compliance --gate`：PASS（23/23）
3. `pnpm check:runtime-go-coverage`：PASS（total 66.5%）
4. `pnpm check:sdk-coverage`：PASS（line 91.32 / branch 71.93 / funcs 93.91）

## 3. 相关提交（同轮）

1. `8b7f3da`：LocalAI adapter capability 分流
2. `33d3053`：Bytedance OpenSpeech STT WS transport
