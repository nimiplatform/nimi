# Nimi Desktop AI Consume 全链路 Legacy 代码审计报告

- 审计日期：2026-02-27
- 审计范围：`apps/desktop/src/runtime/`、`apps/desktop/src/shell/renderer/features/runtime-config/`、`sdk/src/runtime/`、`proto/runtime/v1/`、`runtime/internal/`
- 审计目标：识别 AI Runtime Config、Chat TTS 完整链路、AI Consume 追踪中的所有 legacy 代码

---

## 一、架构总览

### 1.1 三大子系统

| 子系统 | 核心职责 | 关键入口 |
|--------|----------|----------|
| **AI Runtime Config** | Provider 配置、Connector 管理、路由策略 | `runtime-bridge-config.ts` → `runtime-config-panel-*` |
| **Chat TTS** | 文本转语音合成、流式播放 | `speech-service.ts` → `NimiSpeechEngine` → adapter |
| **AI Consume** | Token 用量追踪、推理审计、Usage 聚合 | `usage-tracker.ts` → `inference-audit.ts` → gRPC interceptor |

### 1.2 TTS 完整调用链路

```
Mod (local-chat) → HookRuntimeSpeechService.synthesizeModSpeech()
  → resolveSpeechRoute() → 确定 source (local-runtime / token-api)
    → NimiSpeechEngine.synthesize()
      → synthesizeSpeech() → createSpeechAdapter(providerType)
        → OpenAI/DashScope/Volcengine Adapter → HTTP API 调用
          → SpeechAssetStore.register() → 返回 audioUri
```

流式链路额外经过：
```
  → NimiSpeechEngine.openStream()
    → openSpeechStream() → SpeechStreamRuntime.start()
      → 通过 event topic 推送 audio chunk 给 UI
```

### 1.3 AI Consume 追踪链路

```
Desktop 侧:
  invoke-text/image/video/transcribe → emitInferenceAudit() → 日志记录
  → UsageTracker.record() → InMemory / Tauri 持久化
  → summarizeUsageRecords() → 按时间窗口聚合

Runtime (Go) 侧:
  gRPC interceptor_audit.go → 拦截每个 AI 请求
  → auditlog/store.go → RecordUsage() → 写入 UsageStatRecord
  → ListUsageStats() → 按 minute/hour/day 聚合输出
```

---

## 二、Legacy 代码清单

### L1 [HIGH] Desktop 仍在调用已废弃的 Runtime RPC 方法

**严重度：HIGH** | **影响范围：image/video/transcribe 全链路**

SDK 的 `IRuntimeAiServiceClient` 中有 4 个方法被标记为 `@deprecated`（应迁移至 `SubmitMediaJob/GetMediaJob/GetMediaArtifacts`），但 Desktop adapter 层仍在直接调用它们。

| 废弃方法 | 替代方法 | 仍在调用的文件 |
|----------|----------|----------------|
| `runtime.ai.generateImage()` | `runtime.ai.submitMediaJob()` | `apps/desktop/src/runtime/llm-adapter/execution/invoke-image.ts:36` |
| `runtime.ai.generateVideo()` | `runtime.ai.submitMediaJob()` | `apps/desktop/src/runtime/llm-adapter/execution/invoke-video.ts:36` |
| `runtime.ai.transcribeAudio()` | `runtime.ai.submitMediaJob()` | `apps/desktop/src/runtime/llm-adapter/execution/invoke-transcribe.ts:42` |
| `runtime.ai.synthesizeSpeech()` | `runtime.ai.submitMediaJob()` | SDK test 中仍保留兼容测试 |

proto 定义（`proto/runtime/v1/ai.proto`）：
```proto
// Deprecated: use SubmitMediaJob/GetMediaJob/GetMediaArtifacts.
rpc GenerateImage(...) returns (stream ArtifactChunk);
rpc GenerateVideo(...) returns (stream ArtifactChunk);
rpc SynthesizeSpeech(...) returns (stream ArtifactChunk);
rpc TranscribeAudio(...) returns (TranscribeAudioResponse);
```

Go runtime 侧（`runtime/internal/services/ai/artifact_methods.go`）这些方法的实现实际已经内部转发到 `SubmitMediaJob` + wait，说明 runtime 已完成迁移，但 Desktop 客户端还未跟进。

**vnext-types.ts 已定义新接口但未被 Desktop 采用：**
```typescript
// sdk/src/runtime/vnext-types.ts:383-406
export type RuntimeMediaModule = {
  image: { generate(input): Promise<...>; stream(input): Promise<...> };
  video: { generate(input): Promise<...>; stream(input): Promise<...> };
  tts:   { synthesize(input): Promise<...>; stream(input): Promise<...> };
  stt:   { transcribe(input): Promise<...> };
  jobs:  { submit/get/cancel/subscribe/getArtifacts };
};
```

Desktop 的 `invoke-image.ts`、`invoke-video.ts`、`invoke-transcribe.ts` 应迁移至 `RuntimeMediaModule.jobs.submit()` 或对应的 `image.generate()`/`video.generate()`/`stt.transcribe()` 入口。

---

### L2 [HIGH] NexaNativeAdapter 整个目录为死代码

**严重度：HIGH** | **影响范围：3 个文件，约 100 行**

| 文件 | 状态 |
|------|------|
| `apps/desktop/src/runtime/llm-adapter/providers/nexa-native/adapter.ts` | 定义 `NexaNativeAdapter`，继承 `OpenAICompatibleAdapter` |
| `apps/desktop/src/runtime/llm-adapter/providers/nexa-native/mapping.ts` | 定义 `mapNexaNativeRerankPayload`、`mapNexaNativeCvPayload`、`mapNexaNativeDiarizePayload` |
| `apps/desktop/src/runtime/llm-adapter/providers/nexa-native/index.ts` | 重新导出以上两个模块 |
| `apps/desktop/src/runtime/llm-adapter/providers/index.ts:8` | `export { NexaNativeAdapter } from './nexa-native'` |

**证据：**
1. `createProviderAdapter()` factory（`providers/factory.ts`）不包含 `NEXA_NATIVE` 分支：
   ```typescript
   // factory.ts - 只处理: LOCALAI_NATIVE, DASHSCOPE_COMPATIBLE,
   //              VOLCENGINE_COMPATIBLE, OPENAI_COMPATIBLE, CLOUD_API, fallback
   ```
2. `NexaNativeAdapter` 在整个项目中除了自身定义和 re-export 外无任何使用
3. `mapNexaNativeRerankPayload`/`mapNexaNativeCvPayload`/`mapNexaNativeDiarizePayload` 仅在 `nexa-native/` 内部定义和导出，**从未被任何外部文件调用**

**背景：** 根据 `ssot/runtime/providers/nexa.md`，Nexa 的定位是"受管 provider service"，通过 `providerHints.nexa` 区分而非独立 adapter type。当前 `NexaNativeAdapter` 是一个空壳（仅 8 行，强制转换 type 为 `LOCALAI_NATIVE`），`mapping.ts` 中的 3 个函数为预留的 Nexa 原生能力（rerank/cv/diarize）但从未被集成。

---

### L3 [MEDIUM] SDK method-ids 仍导出废弃方法 ID

**严重度：MEDIUM** | **影响范围：SDK 公共 API 面**

`sdk/src/runtime/method-ids.ts` 中 `RuntimeMethodIds.ai` 仍导出 4 个废弃方法 ID：

```typescript
generateImage:    '/nimi.runtime.v1.RuntimeAiService/GenerateImage'    // DEPRECATED
generateVideo:    '/nimi.runtime.v1.RuntimeAiService/GenerateVideo'    // DEPRECATED
synthesizeSpeech: '/nimi.runtime.v1.RuntimeAiService/SynthesizeSpeech' // DEPRECATED
transcribeAudio:  '/nimi.runtime.v1.RuntimeAiService/TranscribeAudio'  // DEPRECATED
```

这些 ID 被 Tauri IPC transport 的 stream/write method 列表引用，作为合法的 gRPC 方法标识。移除前需确保所有调用方已迁移至 MediaJob API。

---

### L4 [MEDIUM] vnext-types.ts 的 RuntimeAiModule 保留废弃方法签名

**严重度：MEDIUM** | **影响范围：SDK 类型接口**

`sdk/src/runtime/vnext-types.ts:334-373` 中 `RuntimeAiModule` 类型同时包含新旧两套接口：

```typescript
export type RuntimeAiModule = {
  // 新接口 (MediaJob)
  submitMediaJob(...): Promise<...>;
  getMediaJob(...): Promise<...>;
  // ...

  // 废弃接口（仍保留在类型定义中）
  generateImage(...): Promise<AsyncIterable<ArtifactChunk>>;
  generateVideo(...): Promise<AsyncIterable<ArtifactChunk>>;
  synthesizeSpeech(...): Promise<AsyncIterable<ArtifactChunk>>;
  transcribeAudio(...): Promise<TranscribeAudioResponse>;

  // 高层新接口
  text: { generate(...); stream(...) };
  embedding: { generate(...) };
};
```

**问题：** 废弃方法与新 MediaJob 方法共存，增加了使用者的认知负担。`RuntimeMediaModule`（同文件 383-406 行）已经提供了完整的高层替代，但 `RuntimeAiModule` 未清理旧签名。

---

### L5 [MEDIUM] 旧版 config storage keys (v7-v10) 清理代码

**严重度：LOW（代码本身正确）→ MEDIUM（指示 4 次大版本迁移历史）**

`apps/desktop/src/shell/renderer/features/runtime-config/state/v11/storage/defaults.ts:14-19`：

```typescript
const STALE_STORAGE_KEYS_V11 = [
  'nimi.runtime.llm-config.v10',
  'nimi.runtime.llm-config.v9',
  'nimi.runtime.llm-config.v8',
  'nimi.runtime.llm-config.v7',
] as const;
```

`clearStaleKeysV11()` 在每次 load/persist 时执行，确保旧版本数据被清除。这段代码本身是正确的迁移逻辑，但它说明了 runtime config schema 已经历 4 次大版本迁移。如果 v7-v10 用户已经全部升级到 v11，这些 key 可以考虑在未来版本中移除。

---

### L6 [LOW] 废弃 settings selection 值迁移

**严重度：LOW**

`apps/desktop/src/shell/renderer/features/runtime-config/state/v11/storage/persist.ts:59-71`：

```typescript
export function resetSettingsSelectionIfDeprecatedV11(): void {
  // 将旧的 'model-library' 值迁移为 'profile'
  if (storage.getItem('nimi.settings.selected') === 'model-library') {
    storage.setItem('nimi.settings.selected', 'profile');
  }
}
```

`'model-library'` 是一个已被移除的设置面板标签。该函数在 `settings-panel-body.tsx:16` 被调用，确保旧用户不会看到空白页。与 L5 同理，属于过渡迁移代码。

---

### L7 [LOW] console.log 违反项目规范

**严重度：LOW** | **影响范围：3 处**

项目规范明确禁止 `console.log`，要求使用结构化日志。以下位置违规：

| 文件 | 行号 | 内容 | 性质 |
|------|------|------|------|
| `apps/desktop/src/shell/renderer/features/turns/turn-input.tsx` | 105 | `console.log('Selected file:', file.name, 'Type:', file.type)` | 占位代码（TODO: Implement actual file upload） |
| `apps/desktop/src/runtime/hook/services/action-social-precondition.ts` | 64 | `console.warn('[hook-action] social precondition resolver unavailable...')` | 有 eslint-disable 注释 |
| `apps/desktop/src/runtime/telemetry/logger.ts` | 23-30 | `fallbackConsoleLog()` | 日志系统 fallback（可接受） |

其中 `turn-input.tsx:104-105` 同时包含一个未实现的 TODO：
```typescript
// TODO: Implement actual file upload logic here
console.log('Selected file:', file.name, 'Type:', file.type);
```

---

### L8 [LOW] SDK 测试中保留废弃方法兼容测试

**严重度：LOW**

`sdk/test/runtime/runtime-class-coverage.test.ts:767-839` 包含注释 `// Legacy low-level compatibility methods on runtime.ai`，测试了 `generateImage`、`generateVideo`、`synthesizeSpeech`、`transcribeAudio` 四个废弃方法。

这些测试在废弃方法被移除前是必要的，但注释本身表明它们的兼容性质。

---

## 三、TTS 链路特别审计

### 3.1 TTS 链路完整性

TTS 链路由以下层级组成，当前**无 legacy 问题**：

| 层级 | 文件 | 状态 |
|------|------|------|
| Hook 入口 | `runtime/hook/services/speech-service.ts` | 正常 |
| Route 解析 | `speech-service.ts:63-118` `resolveSpeechRoute()` | 正常 |
| 权限审计 | `speech/synthesize.ts` 中的 permission + audit | 正常 |
| 引擎核心 | `llm-adapter/speech/engine/index.ts` `NimiSpeechEngine` | 正常 |
| 合成实现 | `llm-adapter/speech/engine/synthesize.ts` | 正常 |
| 适配器 | `openai-compatible.ts` / `dashscope-compatible.ts` / `volcengine-compatible.ts` | 正常 |
| 流式播放 | `stream-runtime.ts` + `stream-protocol.ts` | 正常 |
| Asset 管理 | `asset-store.ts` | 正常 |

### 3.2 TTS 链路注意点

1. **TTS 未走废弃路径**：Desktop 的 TTS 通过 `NimiSpeechEngine` 直接 HTTP 调用 provider API（而非通过 runtime gRPC `SynthesizeSpeech`），与 image/video 的废弃 gRPC 调用不同。这意味着 TTS 链路不受 L1 影响。

2. **TTS 的 runtime 侧未被 Desktop 使用**：proto 中定义的 `RuntimeAiService.SynthesizeSpeech` RPC 和 Go runtime 中的 TTS 实现（`artifact_methods.go`），目前仅为 SDK 第三方消费者提供，Desktop 自身绕过了 runtime daemon 直接调用 provider HTTP API。

---

## 四、AI Runtime Config 审计

### 4.1 Config 架构

```
UI Panel → State V11 (localStorage)
  ↕ applyRuntimeBridgeConfigToState() / buildRuntimeBridgeConfigFromState()
Tauri Bridge → Runtime Daemon Config (config.json + env vars)
```

### 4.2 Config 相关 Legacy

- **V7-V10 清理代码**（L5）：功能正确，但属于历史迁移遗留
- **model-library 迁移**（L6）：功能正确，一次性迁移代码
- **无 V10 及更早版本的 state 代码残留**：已确认所有 state 相关代码均为 V11 命名空间

---

## 五、汇总与建议

### 5.1 按严重度排序

| ID | 严重度 | 类型 | 描述 | 建议操作 |
|----|--------|------|------|----------|
| L1 | HIGH | 废弃 API 调用 | Desktop invoke-image/video/transcribe 仍调用废弃 RPC | 迁移至 MediaJob API 或 vnext RuntimeMediaModule |
| L2 | HIGH | 死代码 | NexaNativeAdapter 整个目录未被使用 | 删除 `providers/nexa-native/`，清理 `providers/index.ts:8` 导出 |
| L3 | MEDIUM | 废弃导出 | method-ids.ts 导出废弃方法 ID | 待 L1 迁移完成后移除 |
| L4 | MEDIUM | 类型接口冗余 | vnext-types.ts RuntimeAiModule 保留废弃方法签名 | 清理废弃方法类型，仅保留 MediaJob 和高层接口 |
| L5 | LOW | 迁移代码 | v7-v10 storage key 清理 | 可在确认无旧版本用户后移除 |
| L6 | LOW | 迁移代码 | model-library settings 迁移 | 同 L5 |
| L7 | LOW | 规范违反 | 3 处 console.log/warn | 替换为结构化日志或移除 |
| L8 | LOW | 测试 | SDK 测试保留废弃方法兼容测试 | 待 L1 迁移后清理 |

### 5.2 推荐执行顺序

1. **Phase 1 - 高优先级清理**
   - 删除 `providers/nexa-native/` 死代码目录（L2）
   - 迁移 `invoke-image.ts`、`invoke-video.ts`、`invoke-transcribe.ts` 至 MediaJob API（L1）

2. **Phase 2 - SDK 接口清理**
   - 清理 `vnext-types.ts` 废弃方法签名（L4）
   - 移除 `method-ids.ts` 废弃方法导出（L3）
   - 更新 SDK 测试移除兼容测试（L8）

3. **Phase 3 - 低优先级**
   - 修复 console.log 违规（L7）
   - 评估并移除 v7-v10 迁移代码（L5、L6）

### 5.3 与前置审计报告的关系

本报告补充 `desktop-ai-consumption-usability-audit-2026-02-27.md` 中已识别的 P0/P1/P2 问题：
- P0-1（tokenApiKey 与 runtime 认证脱钩）和 P0-2（明文 key 存储）是架构层面的问题
- 本报告中的 L1-L8 是代码层面的 legacy 问题
- L1（废弃 API）和 P0-1 共同说明 Desktop 与 Runtime 之间的推理调用层存在代际落差

---

## 附录 A：涉及文件清单

### Desktop Runtime
- `apps/desktop/src/runtime/llm-adapter/execution/invoke-image.ts`
- `apps/desktop/src/runtime/llm-adapter/execution/invoke-video.ts`
- `apps/desktop/src/runtime/llm-adapter/execution/invoke-transcribe.ts`
- `apps/desktop/src/runtime/llm-adapter/providers/nexa-native/` (整个目录)
- `apps/desktop/src/runtime/llm-adapter/providers/index.ts`
- `apps/desktop/src/runtime/llm-adapter/providers/factory.ts`
- `apps/desktop/src/runtime/llm-adapter/speech/engine/` (完整 TTS 链路)
- `apps/desktop/src/runtime/hook/services/speech-service.ts`
- `apps/desktop/src/runtime/llm-adapter/usage-tracker.ts`
- `apps/desktop/src/runtime/llm-adapter/execution/inference-audit.ts`
- `apps/desktop/src/runtime/telemetry/logger.ts`
- `apps/desktop/src/runtime/hook/services/action-social-precondition.ts`

### Desktop Renderer
- `apps/desktop/src/shell/renderer/features/runtime-config/runtime-bridge-config.ts`
- `apps/desktop/src/shell/renderer/features/runtime-config/state/v11/storage/defaults.ts`
- `apps/desktop/src/shell/renderer/features/runtime-config/state/v11/storage/persist.ts`
- `apps/desktop/src/shell/renderer/features/turns/turn-input.tsx`
- `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts`

### SDK
- `sdk/src/runtime/vnext-types.ts`
- `sdk/src/runtime/method-ids.ts`
- `sdk/src/runtime/generated/runtime/v1/ai.client.ts`
- `sdk/test/runtime/runtime-class-coverage.test.ts`

### Proto & Go Runtime
- `proto/runtime/v1/ai.proto` (废弃 RPC 定义)
- `runtime/internal/services/ai/artifact_methods.go` (废弃方法转发实现)
- `runtime/internal/auditlog/store.go` (Usage 追踪)
- `runtime/internal/grpcserver/interceptor_audit.go` (审计拦截器)
