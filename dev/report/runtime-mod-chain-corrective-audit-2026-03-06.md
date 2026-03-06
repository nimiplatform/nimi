# Runtime Mod Chain Corrective Audit

Date: 2026-03-06

## Summary

本报告用于纠偏 2026-03-06 的全链路审计结论，并记录本轮只修“真实问题”的落地范围。

结论分三类：

- 审计成立：
  - Spec / YAML 的零 legacy 约束成立。
  - Runtime CLI 对 legacy capability 的硬拒绝成立。
  - SDK 活跃公开面已切到 `@nimiplatform/sdk/mod/runtime`。
  - Desktop 活跃 mod/runtime host 链路确实走 `ModRuntimeHost -> getRuntimeClient()`。
  - Web 的 mod stub 是设计边界，不是缺陷。
- 审计失真或不完整：
  - `local-chat`、`videoplay`、`audio-book`、`knowledge-base` 的“声明能力 > 实际调用”判断不成立，代码侧已有真实 image / video / tts / stt / embedding 调用。
  - `meeting-scribe` 不是可加载 mod，而是 spec / test-only 夹层。
  - `sdk/src/mod/ai/` 空目录不是 git 可跟踪残留，不构成 repo 修复项。
  - STT 根因被过度泛化：GLM 与 OpenAI-compatible `/audio/transcriptions` 路径未被本轮证伪，真实失配集中在 Gemini 与 DashScope 的 provider-specific STT 路径。
- 本轮真实修复项：
  - Gemini STT 改为官方 `chat/completions` 音频转写。
  - DashScope STT 改为官方 `compatible-mode/v1/chat/completions` 音频转写。
  - `world-studio` 资产生成从误接 `text.generate` 改为真实 `media.image.generate`。
  - Desktop 删除 5 个不可达 `invoke-*` 死代码，并同步修正文案型 spec 漂移。

## Corrected Findings

### 1. Mod usage audit was materially inaccurate

- `nimi-mods/local-chat` 已有真实 `image.generate` / `video.generate` / `tts.*` / `stt.transcribe` 调用。
- `nimi-mods/videoplay` 已有真实 `image.generate` / `video.generate` / `tts.*` 调用。
- `nimi-mods/audio-book` 已有真实 `tts.listVoices` / `tts.synthesize` 调用。
- `nimi-mods/knowledge-base` 已有真实 `embedding.generate` 调用。
- `nimi-mods/meeting-scribe` 当前没有 `mod.manifest.yaml` 与可加载 `src/` 入口，属于 spec/test-only 样例，不应与可部署 mod 同表统计。

### 2. World Studio was not “unimplemented”; it was miswired

- 真实问题不在于“尚未调用 image.generate”，而在于 `world-studio` 资产生成把 `capability: 'image.generate'` 传进了一个始终调用 `runtimeClient.ai.text.generate()` 的 facade。
- 本轮已把封面、角色肖像、地点图三条链路统一改为 `runtimeClient.media.image.generate()`。
- `imageUrl` 现在取首个 artifact，优先 `uri`，否则编码为 data URL，不再把文本结果写入图片字段。

### 3. STT root cause narrowed to Gemini + DashScope provider-specific paths

- 旧结论“所有 STT adapter 都与上游 API 脱节”不成立。
- 本轮确认并修复：
  - Gemini 不再走 `/operations`，改走官方 `chat/completions` 音频输入。
  - DashScope 不再复用 GLM multipart `/api/v1/services/audio/asr/transcription`，改走官方 `compatible-mode/v1/chat/completions`。
- 本轮未主动改动、仅保留回归锁定：
  - GLM native `/audio/transcriptions`
  - OpenAI / Groq / OpenAI-compatible `/v1/audio/transcriptions`

## Files Updated

- Runtime:
  - `runtime/internal/nimillm/transcription_chat_compat.go`
  - `runtime/internal/nimillm/adapter_gemini.go`
  - `runtime/internal/nimillm/adapter_dashscope.go`
  - `runtime/internal/nimillm/adapter_gemini_test.go`
  - `runtime/internal/nimillm/adapter_dashscope_test.go`
  - `runtime/internal/services/ai/scenario_media_helpers.go`
  - `runtime/internal/services/ai/scenario_media_helpers_unit_test.go`
  - `runtime/internal/services/ai/scenario_job_store.go`
- World Studio:
  - `nimi-mods/world-studio/src/runtime-ai-client.ts`
  - `nimi-mods/world-studio/src/hooks/actions/create/assets-generation.ts`
  - `nimi-mods/world-studio/test/world-studio-asset-generation.test.mjs`
- Desktop / Spec:
  - `apps/desktop/src/runtime/llm-adapter/execution/index.ts`
  - `apps/desktop/src/runtime/llm-adapter/execution/types.ts`
  - deleted: `invoke-stream.ts`, `invoke-image.ts`, `invoke-video.ts`, `invoke-embedding.ts`, `invoke-transcribe.ts`
  - `spec/desktop/kernel/error-boundary-contract.md`

## Verification

Targeted verification for this corrective pass:

- Runtime:
  - `cd runtime && go test ./internal/nimillm ./internal/services/ai`
- World Studio:
  - `pnpm --dir nimi-mods/world-studio test`
  - `pnpm --dir nimi-mods/world-studio typecheck`
- Cross-layer:
  - `pnpm --dir nimi-mods/local-chat typecheck`
  - `pnpm --filter @nimiplatform/sdk test -- --test-name-pattern='mod runtime client'`
  - `npx tsx --tsconfig apps/web/tsconfig.json --test apps/web/test/runtime-mod.web.test.ts`
- Spec:
  - `pnpm check:desktop-spec-kernel-consistency`
  - `pnpm check:desktop-spec-kernel-docs-drift`

## Residual Notes

- 本轮未把 `meeting-scribe` 扩成真正可加载 mod；它仍保持 spec/test-only 定位。
- `@nimiplatform/desktop` 根级 `typecheck` 仍有与本任务无关的基线错误，故本轮验证以受影响路径的 targeted checks 为准。
