# Runtime SSOT 全链路收敛执行证据报告（2026-02-27）

- 日期：2026-02-27
- 范围：SSOT / proto / runtime / sdk / desktop / examples
- 执行策略：当前分支继续推进；不回退；按 WP 原子提交

## 1. 最终结论

1. WP0~WP6 代码收敛已完成并按原子提交落地。
2. 自动化门禁全绿（SSOT/proto/runtime/sdk/desktop/examples）。
3. 真实 smoke：
   - DeepSeek chat：通过。
   - ByteDance tts：执行到真实 provider 调用阶段失败，当前 endpoint/key 组合返回 `Missing required: app.appid`，非编译/链路问题。

## 2. 原子提交序列（已落地）

1. `7843b1c` `chore(ssot): freeze runtime credential/source contracts`
2. `e20080b` `feat(proto): add AI request credential reason codes`
3. `a56b631` `feat(runtime): enforce credential source and request-injected fail-close`
4. `fbf8f12` `feat(runtime): align cli entrypoint and config credential planes`
5. `d0fab1f` `feat(sdk): typed credential metadata and mod credentialRef migration`
6. `4a9dc03` `feat(desktop): credentialRef routing and runtime media speech convergence`
7. `b5a2eb3` `docs(examples): switch to connectorId-first single-file runtime flows`

## 3. 验收门禁记录

### 3.1 SSOT + Scope + Proto

- `pnpm check:ssot-frontmatter` ✅
- `pnpm check:ssot-links` ✅
- `pnpm check:ssot-boundary` ✅
- `pnpm check:ssot-proto-first` ✅
- `rg -n "localOpenAiApiKey" sdk/src/mod apps/desktop/src` ✅（0 命中）
- `pnpm proto:lint` ✅
- `pnpm proto:breaking` ✅
- `pnpm proto:generate` ✅
- `pnpm proto:drift-check` ✅

### 3.2 Runtime

- `cd runtime && go test ./...` ✅
- `cd runtime && go run ./cmd/runtime-compliance --gate` ✅（23/23）

### 3.3 SDK

- `pnpm --filter @nimiplatform/sdk build` ✅
- `pnpm --filter @nimiplatform/sdk test` ✅
- `pnpm check:sdk-coverage` ✅（lines 91.55 / branches 73.02 / funcs 93.98）

### 3.4 Desktop

- `pnpm -C apps/desktop exec tsc --noEmit` ✅
- `pnpm -C apps/desktop exec tsx --test test/runtime-route-resolver-v11.test.ts test/runtime-bridge-invoke.test.ts test/runtime-bootstrap-speech-route-resolver.test.ts` ✅
- `pnpm -C apps/desktop exec tsx --test test/runtime-bridge-config.test.ts test/runtime-daemon-state.test.ts test/runtime-config-split-contract.test.ts` ✅
- `cd apps/desktop/src-tauri && cargo test runtime_bridge` ✅（34 passed）

### 3.5 Examples

- `pnpm check:examples` ✅

## 4. 真实 Smoke 证据

### 4.1 DeepSeek Chat（通过）

执行（runtime 独立实例）：

```bash
NIMI_RUNTIME_GRPC_ADDR=127.0.0.1:56371 \
NIMI_RUNTIME_HTTP_ADDR=127.0.0.1:56372 \
NIMI_RUNTIME_CLOUD_LITELLM_BASE_URL=https://api.deepseek.com \
NIMI_RUNTIME_CLOUD_LITELLM_API_KEY=$DEEPSEEK_API_KEY \
go run ./runtime/cmd/nimi serve

NIMI_RUNTIME_GRPC_ENDPOINT=127.0.0.1:56371 \
NIMI_DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY \
npx tsx docs/examples/providers/deepseek-chat.ts
```

结果：✅ 输出有效文本（已记录 `connectorId`、model、response）。

### 4.2 ByteDance TTS（真实 provider 阻塞）

执行：

```bash
NIMI_RUNTIME_GRPC_ENDPOINT=127.0.0.1:56371 \
NIMI_BYTEDANCE_API_KEY=$NIMI_BYTEDANCE_API_KEY \
NIMI_BYTEDANCE_ENDPOINT=https://openspeech.bytedance.com \
npx tsx docs/examples/providers/bytedance-tts.ts
```

结果：❌ `tts job failed: status=5 detail=rpc error: code = InvalidArgument desc = AI_INPUT_INVALID`

附加探针（同 endpoint/key）：

```bash
curl -X POST "$NIMI_BYTEDANCE_ENDPOINT/api/v1/tts" ...
```

返回：

```text
{"code":3001,"message":"... Missing required: app.appid"}
```

判定：当前 ByteDance 凭证/endpoint 还缺 provider 所需业务参数（至少 `app.appid` 语义），链路实现已打通但无法在该凭证上下文完成真实 TTS 合成。

## 5. 后续动作（仅剩 provider 参数补齐）

1. 提供可用的 ByteDance OpenSpeech endpoint 与必需业务参数（例如 app/appid 对应配置）。
2. 复跑：

```bash
export NIMI_RUNTIME_GRPC_ENDPOINT=127.0.0.1:56371
export NIMI_BYTEDANCE_API_KEY=<valid_key>
export NIMI_BYTEDANCE_ENDPOINT=<valid_endpoint>
npx tsx docs/examples/providers/bytedance-tts.ts
```

通过标准：输出 `[bytedance-tts][saved] <path>` 且音频文件可落地。
