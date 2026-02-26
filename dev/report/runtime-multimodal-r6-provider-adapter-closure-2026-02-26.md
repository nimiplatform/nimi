# Runtime 多模态 R6 Provider Adapter 收口报告

- 报告日期：2026-02-26
- 范围：`runtime/internal/services/ai/*`、`runtime/internal/daemon/*`
- 对照基线：`dev/research/multimodal-provider-audit-2026-02-24.md`

## 1. 结论

1. `localai + nexa`：已接入；`nexa` 的 `video` 仍保持 fail-close（`AI_ROUTE_UNSUPPORTED`），符合当前实现边界。
2. `litellm`：已完整接入（text/embed/image/video/tts/stt 统一 openai-compatible 路径）。
3. “第三方非兼容模型自定义最大兼容”：本轮完成 `Bytedance ARK`（image/video task）和 `Alibaba native`（image/video/tts/stt），并保留 `Gemini/MiniMax/Kimi/GLM/Bytedance OpenSpeech` 自定义适配链路。
4. 本地 image/tts/stt/video：`LocalAI` 四模态支持；`Nexa` 支持 image/tts/stt，video fail-close。
5. 测试：单测矩阵+coverage gate 已通过；live smoke 已扩展到 local/litellm/bytedance/alibaba/gemini/minimax/glm 四模态与 kimi（三模态：image/tts/stt），按环境变量可选执行。

## 2. 本轮新增收口项

1. Bytedance ARK task adapter
   - `bytedance` 的 `image/video` 从默认兼容路径提升为专用适配（含 task submit/poll）。
   - 代码：`adapterBytedanceARKTask`、`executeBytedanceARKTask`、`pollProviderTaskForArtifact`。
2. Alibaba native adapter
   - `alibaba/aliyun` 的 `image/video/tts/stt` 走专用路径；其中 `image/video` 使用 task submit/poll。
   - 代码：`adapterAlibabaNative`、`executeAlibabaNative`。
3. provider 自定义兼容能力验证
   - 新增 `provider_options` 自定义 submit/query path 测试。
4. live smoke 扩展
   - 新增 Bytedance/Alibaba/Gemini/MiniMax/GLM 四模态 live smoke 组测试与 Kimi（三模态）live smoke 组；与既有 local/litellm 形成统一 live 入口。

## 3. 关键代码定位

1. Adapter 分发与路由
   - `runtime/internal/services/ai/media_job_methods.go:36`
   - `runtime/internal/services/ai/media_job_methods.go:208`
   - `runtime/internal/services/ai/media_job_methods.go:379`
2. Bytedance ARK + Alibaba native 实现
   - `runtime/internal/services/ai/media_job_methods.go:1089`
   - `runtime/internal/services/ai/media_job_methods.go:1248`
   - `runtime/internal/services/ai/media_job_methods.go:1503`
3. Daemon provider health 目标扩展（含 kimi/glm）
   - `runtime/internal/daemon/daemon.go:252`
   - `runtime/internal/daemon/daemon.go:281`
   - `runtime/internal/daemon/daemon_audit_test.go:68`

## 4. 测试与门禁

1. 单测（新增）
   - `runtime/internal/services/ai/media_job_methods_test.go:421`
   - `runtime/internal/services/ai/media_job_methods_test.go:476`
   - `runtime/internal/services/ai/media_job_methods_test.go:517`
   - `runtime/internal/services/ai/media_job_methods_test.go:669`
   - `runtime/internal/services/ai/media_job_methods_test.go:723`
   - `runtime/internal/services/ai/media_job_methods_test.go:768`
   - `runtime/internal/services/ai/media_job_methods_test.go:822`
   - `runtime/internal/services/ai/media_job_methods_test.go:2766`
2. live smoke（新增）
   - `runtime/internal/services/ai/live_provider_smoke_test.go:81`
   - `runtime/internal/services/ai/live_provider_smoke_test.go:180`
   - `runtime/internal/services/ai/live_provider_smoke_test.go:277`
   - `runtime/internal/services/ai/live_provider_smoke_test.go:384`
   - `runtime/internal/services/ai/live_provider_smoke_test.go:481`
   - `runtime/internal/services/ai/live_provider_smoke_test.go:578`
   - `runtime/internal/services/ai/live_provider_smoke_test.go:675`
   - `runtime/internal/services/ai/live_provider_smoke_test.go:752`
3. 门禁状态
   - `check:runtime-ai-media-coverage`：PASS（statements 73.0%，SubmitMediaJob 82.9%）
   - `check:runtime-go-coverage`：PASS（total 67.7%）

## 5. 残余风险

1. live smoke 仍依赖外部环境与可用模型；默认 CI 环境不会覆盖真实 provider 连通性。
2. Nexa video 仍是能力边界（fail-close），若后续支持视频需独立 adapter 与契约更新。
