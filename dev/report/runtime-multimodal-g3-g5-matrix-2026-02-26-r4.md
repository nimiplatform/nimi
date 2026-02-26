# Runtime 多模态 G3+G5 测试矩阵报告 R4

- 报告日期：2026-02-26
- 范围：`runtime/internal/services/ai`、`runtime/internal/services/localruntime`、`runtime/internal/services/workflow`
- 目标 Gate：`G3 + G5`
- 结论：`PASS`（矩阵无“未测”，coverage 达标）

## 1. 门禁结果

1. `pnpm check:runtime-go-coverage`：`66.0%`（scope: `./internal/services/...`，门槛 `>=60%`）
2. `pnpm check:runtime-ai-media-coverage`：
   - `internal/services/ai`：`72.9%`（门槛 `>=70%`）
   - media core 函数：
     - `SubmitMediaJob` `81.5%`
     - `GetMediaJob` `100.0%`
     - `CancelMediaJob` `100.0%`
     - `SubscribeMediaJobEvents` `81.0%`
     - `GetMediaArtifacts` `100.0%`

## 2. Provider x Modality 矩阵

| Provider | Modality | RoutePolicy | Sync/Async | Stream | 结果 | 证据 |
|---|---|---|---|---|---|---|
| LocalAI | text | local-runtime | sync | non-stream | PASS | `TestGenerateSuccess` (`runtime/internal/services/ai/service_test.go`) |
| LocalAI | text | local-runtime | sync | stream | PASS | `TestStreamGenerateSequence` (`runtime/internal/services/ai/service_test.go`) |
| LocalAI | embed | local-runtime | sync | non-stream | PASS | `TestEmbedLegacyWrapper` (`runtime/internal/services/ai/artifact_methods_test.go`) |
| LocalAI | image | local-runtime | sync | stream | PASS | `TestGenerateImageChunked` (`runtime/internal/services/ai/service_test.go`) |
| LocalAI | image | local-runtime | async | non-stream | PASS | `TestSubmitMediaJobImageCompletes` (`runtime/internal/services/ai/media_job_methods_test.go`) |
| LocalAI | video | local-runtime | sync | stream | PASS | `TestLegacyMediaWrappersVideoSpeechAndTranscribe` (`runtime/internal/services/ai/artifact_methods_test.go`) |
| LocalAI | tts | local-runtime | sync | stream | PASS | `TestLegacyMediaWrappersVideoSpeechAndTranscribe` (`runtime/internal/services/ai/artifact_methods_test.go`) |
| LocalAI | stt | local-runtime | sync | non-stream | PASS | `TestLegacyMediaWrappersVideoSpeechAndTranscribe` (`runtime/internal/services/ai/artifact_methods_test.go`) |
| Nexa | text | local-runtime | sync | non-stream | PASS | `TestLocalProviderNexaModalitiesAndFailCloseVideo` (`runtime/internal/services/ai/provider_local_test.go`) |
| Nexa | embed | local-runtime | sync | non-stream | PASS | `TestLocalProviderNexaModalitiesAndFailCloseVideo` (`runtime/internal/services/ai/provider_local_test.go`) |
| Nexa | image | local-runtime | sync | non-stream | PASS | `TestLocalProviderNexaModalitiesAndFailCloseVideo` (`runtime/internal/services/ai/provider_local_test.go`) |
| Nexa | tts | local-runtime | sync | non-stream | PASS | `TestLocalProviderNexaModalitiesAndFailCloseVideo` (`runtime/internal/services/ai/provider_local_test.go`) |
| Nexa | stt | local-runtime | sync | non-stream | PASS | `TestLocalProviderNexaModalitiesAndFailCloseVideo` (`runtime/internal/services/ai/provider_local_test.go`) |
| Nexa | video | local-runtime | sync | non-stream | PASS（unsupported fail-close） | `TestLocalProviderNexaModalitiesAndFailCloseVideo` + `TestLocalRuntimeNodeCatalogNexaVideoFailClose` |
| LiteLLM | text | token-api | sync | non-stream | PASS | `TestCloudProviderRoutesByPrefix` (`runtime/internal/services/ai/provider_cloud_test.go`) |
| LiteLLM | embed | token-api | sync | non-stream | PASS | `TestCloudProviderLiteLLMAllModalities` (`runtime/internal/services/ai/provider_cloud_test.go`) |
| LiteLLM | image | token-api | sync | non-stream | PASS | `TestCloudProviderLiteLLMAllModalities` (`runtime/internal/services/ai/provider_cloud_test.go`) |
| LiteLLM | video | token-api | sync | non-stream | PASS | `TestCloudProviderLiteLLMAllModalities` (`runtime/internal/services/ai/provider_cloud_test.go`) |
| LiteLLM | tts | token-api | sync | non-stream | PASS | `TestCloudProviderLiteLLMAllModalities` (`runtime/internal/services/ai/provider_cloud_test.go`) |
| LiteLLM | stt | token-api | sync | non-stream | PASS | `TestCloudProviderLiteLLMAllModalities` (`runtime/internal/services/ai/provider_cloud_test.go`) |
| ByteDance (custom) | tts | token-api | async | non-stream | PASS | `TestSubmitMediaJobBytedanceOpenSpeechTTS` (`runtime/internal/services/ai/media_job_methods_test.go`) |
| ByteDance (custom) | stt | token-api | async | non-stream | PASS | `TestSubmitMediaJobBytedanceOpenSpeechSTT` (`runtime/internal/services/ai/media_job_methods_test.go`) |
| ByteDance (video task) | video | token-api | async | non-stream | PASS | `TestSubmitMediaJobBytedanceVideoViaOpenAICompat` (`runtime/internal/services/ai/media_job_methods_test.go`) |
| Gemini (custom) | image | token-api | async | non-stream | PASS | `TestSubmitMediaJobGeminiImageOperation` (`runtime/internal/services/ai/media_job_methods_test.go`) |
| Gemini (custom) | video | token-api | async | non-stream | PASS | `TestSubmitMediaJobGeminiOperation` (`runtime/internal/services/ai/media_job_methods_test.go`) |
| MiniMax (custom) | image | token-api | async | non-stream | PASS | `TestSubmitMediaJobMiniMaxTask` (`runtime/internal/services/ai/media_job_methods_test.go`) |
| MiniMax (custom) | video | token-api | async | non-stream | PASS | `TestSubmitMediaJobMiniMaxVideoTask` (`runtime/internal/services/ai/media_job_methods_test.go`) |

## 3. 异常语义矩阵（success/unsupported/timeout/unavailable）

| 场景 | 预期语义 | 结果 | 证据 |
|---|---|---|---|
| success | 正常返回 artifact/text + usage | PASS | 上表全部 success 用例 |
| unsupported | fail-close，返回 `AI_ROUTE_UNSUPPORTED`/`FailedPrecondition` | PASS | `TestLocalProviderNexaModalitiesAndFailCloseVideo`, `TestOpenAIBackendVideoUnsupported` |
| timeout | 返回 `AI_PROVIDER_TIMEOUT` / deadline exceeded | PASS | `TestGenerateHonorsRequestTimeout`, `TestStreamGenerateFirstPacketTimeoutEmitsFailedEvent` |
| unavailable | 返回 `AI_PROVIDER_UNAVAILABLE`，不做伪成功回退 | PASS | `TestCloudProviderExplicitBackendMissing` |

## 4. External Async E2E

| 用例 | 结果 | 证据 |
|---|---|---|
| Workflow external-async image node submit/poll/complete | PASS | `TestWorkflowExternalAsyncMediaNode` (`runtime/internal/services/workflow/executor_ai_test.go`) |
| Async media job cancel + event subscribe | PASS | `TestCancelMediaJobAndSubscribeLive` (`runtime/internal/services/ai/media_job_methods_test.go`) |

## 5. 发布判定（G3 + G5）

1. G3：PASS（LocalAI/Nexa/LiteLLM/ByteDance/Gemini/MiniMax 均有实链路证据，且 unsupported 路径 fail-close）。
2. G5：PASS（矩阵无“未测”，coverage 三条门槛达标）。
