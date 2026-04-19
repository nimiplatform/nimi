# SDK Runtime Route Contract

> Owner Domain: `S-RUNTIME-*`

## Scope

定义 app-facing `runtime.route.*` typed surface，覆盖 host typed surface、mod stable contract、以及 `runtime.route.describe(...)` 的 SDK projection 边界。

## S-RUNTIME-074 App-Facing Route Typed Surface

SDK app-facing route facade 固定暴露以下 logical operation：

- `runtime.route.listOptions(...)`
- `runtime.route.resolve(...)`
- `runtime.route.checkHealth(...)`
- `runtime.route.describe(...)`

其中：

- `runtime.route.describe(...)` 在 Phase 1 的 stable authority home 是 host typed surface / mod injected route facade。
- 本轮不得把 `describe(...)` 定义成 direct daemon convenience method，也不得要求 `new Runtime()` 必须具备与 daemon 顶层 RPC 一一对应的 `describe()`。
- `describe(...)` 相关类型和值域必须直接继承 `K-RPC-015` ~ `K-RPC-021`，不得在 SDK 再发明第二套 route metadata schema。

## S-RUNTIME-075 Typed Describe Result Projection

SDK 稳定 typed result `RuntimeRouteDescribeResult` 必须保持以下公共字段：

- `capability`
- `metadataVersion`
- `resolvedBindingRef`
- `metadataKind`
- `metadata`

`metadata` 必须是 discriminated union，最小 Phase 1 variants 固定为：

- `TextGenerateRouteMetadata`
- `VoiceWorkflowTtsV2vRouteMetadata`
- `VoiceWorkflowTtsT2vRouteMetadata`

字段和值域必须与 `K-RPC-017` 同形：

- `TextGenerateRouteMetadata.traceModeSupport` 只能是 `'none' | 'hide' | 'separate'`
- `VoiceWorkflow*RouteMetadata.workflowType` 只能是 `'tts_v2v'` 或 `'tts_t2v'`
- 不得把结果降格为 `Struct`、`Record<string, unknown>`、provider raw payload 或自由字符串 map

## S-RUNTIME-076 Fail-Close Projection

SDK 对 `runtime.route.describe(...)` 的稳定消费必须 fail-close：

- 缺失 `metadataKind`
- 缺失 `K-RPC-017` 要求的任一 typed field
- 枚举值超出规范值域
- `capability`、`metadataKind`、`resolvedBindingRef` 三者不一致

发生上述任一情形时，SDK 必须直接报错；不得：

- 回落到 `resolve + checkHealth` 视为 metadata 成功
- 用 provider/model 名称或 local/cloud 假设补猜 `supportsThinking`、`supports*Input`、workflow metadata
- 暴露 product-facing fallback knob 让调用方选择 fail-open

## S-RUNTIME-077 Mod Stable Contract Boundary

mod-facing 的 `runtime.route.*` 能力只允许通过 host-injected typed facade 暴露。

- mod 可消费 `listOptions / resolve / checkHealth / describe` 的 typed result，但不得获得 writable global route truth 或 Desktop metadata cache ownership。
- mod 若消费 `ConversationCapabilityProjection`，必须把其视为 Desktop host 提供的 read model；不得回写 thread-level `routeSnapshot`、不得把 `runtimeFields` 重新当作 route owner。
- mod stable surface 不得暴露 `reasonCode: string | null` 形式的自由文本 route metadata/projection reason。

## S-RUNTIME-078 Runtime Client Projection Boundary

`@nimiplatform/sdk/runtime` 在 Phase 1 可以共享 `runtime.route.describe(...)` 的 typed result types，但不得把它包装成“新增 daemon 顶层 RPC 已存在”的公开承诺。

- 允许共享类型与 host facade interface。
- 不允许在 runtime client surface 上引入与 `K-RPC-020` 冲突的 transport 假设。
- 在 runtime transport authority 正式定稿前，route metadata 的 app-facing 成功路径以 host typed surface 为准；SDK 不得先行发明私有临时 API。
- route facade 可能被 host/runtime memory binding 解析路径复用作 legality /
  health dependency，但 `runtime.route.*` 本身不是 memory embedding editable
  config surface，也不是 canonical bank bind / cutover command surface。
