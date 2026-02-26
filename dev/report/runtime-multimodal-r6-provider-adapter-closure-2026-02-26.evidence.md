# Runtime 多模态 R6 Provider Adapter 收口证据

- 日期：2026-02-26
- 关联报告：`dev/report/runtime-multimodal-r6-provider-adapter-closure-2026-02-26.md`

## 1. 命令证据

1. `cd runtime && go test ./internal/services/ai/... -run TestLiveSmoke`：PASS
2. `cd runtime && go test ./internal/services/ai/...`：PASS
3. `pnpm -s check:runtime-ai-media-coverage`：PASS
   - ai statements coverage: `73.0%`
   - `SubmitMediaJob`: `82.9%`
4. `pnpm -s check:runtime-go-coverage`：PASS
   - total statements coverage: `67.7%`
5. `cd runtime && go test ./internal/daemon/...`：PASS

## 2. 代码证据定位

1. Adapter 定义与路由
   - `runtime/internal/services/ai/media_job_methods.go:36`
   - `runtime/internal/services/ai/media_job_methods.go:208`
   - `runtime/internal/services/ai/media_job_methods.go:379`
2. Bytedance ARK 实现
   - `runtime/internal/services/ai/media_job_methods.go:1089`
3. Alibaba native 实现
   - `runtime/internal/services/ai/media_job_methods.go:1248`
4. 通用 task 轮询
   - `runtime/internal/services/ai/media_job_methods.go:1503`
5. provider health 目标扩展（kimi/glm）
   - `runtime/internal/daemon/daemon.go:252`
   - `runtime/internal/daemon/daemon.go:281`

## 3. 测试证据定位

1. Bytedance/Alibaba adapter 单测
   - `runtime/internal/services/ai/media_job_methods_test.go:421`
   - `runtime/internal/services/ai/media_job_methods_test.go:476`
   - `runtime/internal/services/ai/media_job_methods_test.go:517`
   - `runtime/internal/services/ai/media_job_methods_test.go:669`
   - `runtime/internal/services/ai/media_job_methods_test.go:723`
   - `runtime/internal/services/ai/media_job_methods_test.go:768`
   - `runtime/internal/services/ai/media_job_methods_test.go:822`
   - `runtime/internal/services/ai/media_job_methods_test.go:2766`
2. live smoke 多模态测试
   - `runtime/internal/services/ai/live_provider_smoke_test.go:81`
   - `runtime/internal/services/ai/live_provider_smoke_test.go:180`
   - `runtime/internal/services/ai/live_provider_smoke_test.go:277`
   - `runtime/internal/services/ai/live_provider_smoke_test.go:384`
   - `runtime/internal/services/ai/live_provider_smoke_test.go:481`
   - `runtime/internal/services/ai/live_provider_smoke_test.go:578`
   - `runtime/internal/services/ai/live_provider_smoke_test.go:675`
   - `runtime/internal/services/ai/live_provider_smoke_test.go:752`

## 4. Live Smoke 环境变量清单（新增）

1. 公共 STT 输入
   - `NIMI_LIVE_STT_AUDIO_URI`
   - `NIMI_LIVE_STT_MIME_TYPE`（可选，默认 `audio/wav`）
2. Bytedance
   - `NIMI_LIVE_BYTEDANCE_BASE_URL`
   - `NIMI_LIVE_BYTEDANCE_API_KEY`
   - `NIMI_LIVE_BYTEDANCE_SPEECH_BASE_URL`（可选，默认同 BASE_URL）
   - `NIMI_LIVE_BYTEDANCE_SPEECH_API_KEY`（可选，默认同 API_KEY）
   - `NIMI_LIVE_BYTEDANCE_IMAGE_MODEL_ID`
   - `NIMI_LIVE_BYTEDANCE_VIDEO_MODEL_ID`
   - `NIMI_LIVE_BYTEDANCE_TTS_MODEL_ID`
   - `NIMI_LIVE_BYTEDANCE_STT_MODEL_ID`
3. Alibaba
   - `NIMI_LIVE_ALIBABA_BASE_URL`
   - `NIMI_LIVE_ALIBABA_API_KEY`
   - `NIMI_LIVE_ALIBABA_IMAGE_MODEL_ID`
   - `NIMI_LIVE_ALIBABA_VIDEO_MODEL_ID`
   - `NIMI_LIVE_ALIBABA_TTS_MODEL_ID`
   - `NIMI_LIVE_ALIBABA_STT_MODEL_ID`
4. Gemini
   - `NIMI_LIVE_GEMINI_BASE_URL`
   - `NIMI_LIVE_GEMINI_API_KEY`
   - `NIMI_LIVE_GEMINI_IMAGE_MODEL_ID`
   - `NIMI_LIVE_GEMINI_VIDEO_MODEL_ID`
   - `NIMI_LIVE_GEMINI_TTS_MODEL_ID`
   - `NIMI_LIVE_GEMINI_STT_MODEL_ID`
5. MiniMax
   - `NIMI_LIVE_MINIMAX_BASE_URL`
   - `NIMI_LIVE_MINIMAX_API_KEY`
   - `NIMI_LIVE_MINIMAX_IMAGE_MODEL_ID`
   - `NIMI_LIVE_MINIMAX_VIDEO_MODEL_ID`
   - `NIMI_LIVE_MINIMAX_TTS_MODEL_ID`
   - `NIMI_LIVE_MINIMAX_STT_MODEL_ID`
6. Kimi
   - `NIMI_LIVE_KIMI_BASE_URL`
   - `NIMI_LIVE_KIMI_API_KEY`
   - `NIMI_LIVE_KIMI_IMAGE_MODEL_ID`
   - `NIMI_LIVE_KIMI_TTS_MODEL_ID`
   - `NIMI_LIVE_KIMI_STT_MODEL_ID`
7. GLM
   - `NIMI_LIVE_GLM_BASE_URL`
   - `NIMI_LIVE_GLM_API_KEY`
   - `NIMI_LIVE_GLM_IMAGE_MODEL_ID`
   - `NIMI_LIVE_GLM_VIDEO_MODEL_ID`
   - `NIMI_LIVE_GLM_TTS_MODEL_ID`
   - `NIMI_LIVE_GLM_STT_MODEL_ID`
