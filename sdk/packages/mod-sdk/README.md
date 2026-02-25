# @nimiplatform/mod-sdk

`@nimiplatform/mod-sdk` 是 Nimi Desktop 的 Mod 运行时 SDK。  
它提供三类能力：

1. HookClient V2：统一访问 event/data/turn/ui/inter-mod/llm/audit/meta。
2. AI Facade：`createAiClient`（`generateText|streamText|generateObject|generateImage|generateVideo|transcribeAudio|generateEmbedding|synthesizeSpeech`）统一多模态能力入口。
3. UI + Logging API：渲染层状态访问、Slot 渲染、统一日志上报。

---

## 1. 导出入口

`package.json` 当前导出如下：

- `@nimiplatform/mod-sdk/types`
- `@nimiplatform/mod-sdk/hook`
- `@nimiplatform/mod-sdk/host`（runtime 装配内部入口）
- `@nimiplatform/mod-sdk/ai`
- `@nimiplatform/mod-sdk/model-options`
- `@nimiplatform/mod-sdk/runtime-route`
- `@nimiplatform/mod-sdk/ui`
- `@nimiplatform/mod-sdk/logging`
- `@nimiplatform/mod-sdk/utils`

---

## 2. 快速使用（Mod 侧）

```ts
import { createHookClient } from '@nimiplatform/mod-sdk/hook';

const hook = createHookClient('world.nimi.local-chat');

await hook.data.register({
  capability: 'data-api.local-chat.chat-targets.list',
  handler: async () => [{ id: 'local-model', name: 'Local Runtime Default' }],
});

await hook.ui.register({
  slot: 'runtime.devtools.panel',
  priority: 0,
  extension: {
    extensionId: 'ui-extension.runtime.devtools.panel:world.nimi.local-chat:0',
    strategy: 'append',
  },
});
```

推荐直接使用 `createHookClient(modId)`。

---

## 3. HookClient V2 接口清单

通过 `createHookClient(modId)` 获得：

### `hook.event`

- `subscribe({ topic, handler, once? })`
- `unsubscribe({ topic? })`
- `publish({ topic, payload })`
- `listTopics()`

### `hook.data`

- `query({ capability, query })`
- `register({ capability, handler })`
- `unregister({ capability })`
- `listCapabilities()`

### `hook.turn`

- `register({ point, priority?, handler })`
- `unregister({ point })`
- `invoke({ point, context, abortSignal? })`

`point` 目前支持：

- `pre-policy`
- `pre-model`
- `post-state`
- `pre-commit`

### `hook.ui`

- `register({ slot, priority?, extension })`
- `unregister({ slot? })`
- `resolve(slot)`
- `listSlots()`

### `hook.interMod`

- `registerHandler({ channel, handler })`
- `unregisterHandler({ channel? })`
- `request({ toModId, channel, payload, context? })`
- `broadcast({ channel, payload, context? })`
- `discover()`

### `hook.llm`

- `text.generate({ provider, prompt, mode?, worldId?, agentId?, abortSignal?, localProviderEndpoint?, localProviderModel?, localOpenAiEndpoint?, localOpenAiApiKey? })`
- `text.stream({ provider, prompt, mode?, worldId?, agentId?, abortSignal?, localProviderEndpoint?, localProviderModel?, localOpenAiEndpoint?, localOpenAiApiKey? })`
- `image.generate({ provider, prompt, model?, size?, n?, localProviderEndpoint?, localProviderModel?, localOpenAiEndpoint?, localOpenAiApiKey? })`
- `video.generate({ provider, prompt, model?, durationSeconds?, localProviderEndpoint?, localProviderModel?, localOpenAiEndpoint?, localOpenAiApiKey? })`
- `embedding.generate({ provider, input, model?, localProviderEndpoint?, localProviderModel?, localOpenAiEndpoint?, localOpenAiApiKey? })`
- `checkHealth(input)`
- `checkRouteHealth({ routeHint, routeOverride? })`
  - 返回 `status/detail/provider`，并附带 `reasonCode` 与 `actionHint` 供 UI 做修复引导。
- `speech.listProviders()`
- `speech.listVoices({ providerId? })`
- `speech.synthesize({ text, providerId?, voiceId, format?, speakingRate?, pitch?, sampleRateHz?, targetId?, sessionId? })`
- `speech.transcribe({ provider, audioUri?, audioBase64?, mimeType?, language?, localProviderEndpoint?, localProviderModel?, localOpenAiEndpoint?, localOpenAiApiKey? })`
- `speech.stream.open({ text, providerId?, voiceId, format?, sampleRateHz?, targetId?, sessionId? })`
- `speech.stream.control({ streamId, action })`
- `speech.stream.close({ streamId })`

### `hook.audit`

- `query(filter?)`
- `stats(modId?)`

### `hook.meta`

- `listRegistrations(modId?)`
- `listCapabilities(modId)`
- `getPermissions(modId)`

---

## 4. AI Facade（`@nimiplatform/mod-sdk/ai`）

```ts
import { createAiClient } from '@nimiplatform/mod-sdk/ai';

const ai = createAiClient('world.nimi.local-chat');
const text = await ai.generateText({
  routeHint: 'chat/default',
  prompt: 'hello',
});
```

当前稳定能力（v2）：

- `generateText(input)`
- `streamText(input)`
- `generateObject(input)`
- `generateImage(input)`
- `generateVideo(input)`
- `transcribeAudio(input)`
- `generateEmbedding(input)`
- `synthesizeSpeech(input)`

---

## 5. UI API（`@nimiplatform/mod-sdk/ui`）

- `useAppStore(selector)`
- `useUiExtensionContext()`
- `SlotHost({ slot, base, context })`

示例：

```tsx
import { SlotHost, useUiExtensionContext } from '@nimiplatform/mod-sdk/ui';

export function MyPanel() {
  const context = useUiExtensionContext();
  return (
    <SlotHost
      slot="runtime.local-chat.header.badges"
      base={<span>Base Badge</span>}
      context={context}
    />
  );
}
```

---

## 6. Logging API（`@nimiplatform/mod-sdk/logging`）

- `emitRuntimeLog(payload)`
- `createRendererFlowId(prefix)`
- `logRendererEvent(payload)`

示例：

```ts
import { createRendererFlowId, logRendererEvent } from '@nimiplatform/mod-sdk/logging';

const flowId = createRendererFlowId('local-chat');
logRendererEvent({
  level: 'info',
  area: 'local-chat',
  message: 'action:panel-mounted',
  flowId,
});
```

---

## 7. Host 集成要求（平台/宿主侧，内部）

在 Mod 运行前，宿主必须先调用：

`setModSdkHost(host)` 属于宿主内部装配能力，不属于 Mod 业务侧稳定 API。

并提供以下能力：

- `host.runtime.*`：runtime 调用与 hook runtime facade
- `host.ui.*`：`useAppStore`、`useUiExtensionContext`、`SlotHost`
- `host.logging.*`：runtime/renderer 日志方法

可选清理：

- `clearModSdkHost()`

未注入 host 时调用 SDK 会抛错：

- `MOD_SDK_HOST_NOT_READY`

---

## 8. 错误与约束

- `HOOK_CLIENT_MOD_ID_REQUIRED`：`createHookClient` 传入空 `modId`。
- 权限由 runtime hook 网关判定；SDK 暴露接口不代表一定可调用成功。
- sideload mod 的实际能力受 manifest 与 runtime 策略双重约束。

---

## 9. 能力键命名建议

建议采用稳定的 capability key：

- `event.publish.<topic>`
- `event.subscribe.<topic>`
- `data.query.<capability>`
- `data.register.<capability>`
- `turn.register.<point>`
- `ui.register.<slot>`
- `inter-mod.request.<channel>`
- `inter-mod.provide.<channel>`
- `llm.text.generate`
- `llm.text.stream`
- `llm.image.generate`
- `llm.video.generate`
- `llm.embedding.generate`
- `llm.speech.providers.list`
- `llm.speech.voices.list`
- `llm.speech.synthesize`
- `llm.speech.stream.open`
- `llm.speech.stream.control`
- `llm.speech.stream.close`
- `llm.speech.transcribe`

这有助于权限审计、策略收敛和兼容升级。

---
