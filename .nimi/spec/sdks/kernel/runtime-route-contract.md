# SDK Runtime Route Contract

> Owner Domain: `S-RUNTIME-*`

## S-RUNTIME-000 Runtime Target Identity v2 Hard Cut

Runtime route APIs consume v2 durable target refs, return inventory projection
for options, and expose resolved execution binding for execution/describe
truth. Legacy route bindings, `localModelId`, and raw provider/model ids must
not be used as durable target identity.

## Scope

定义 app-facing `runtime.route.*` typed surface，覆盖 host typed surface 以及 `runtime.route.describe(...)` 的 SDK projection 边界。

## S-RUNTIME-074 App-Facing Route Typed Surface

SDK app-facing route facade 固定暴露以下 logical operation：

- `runtime.route.listOptions(...)`
- `runtime.route.resolve(...)`
- `runtime.route.checkHealth(...)`
- `runtime.route.describe(...)`

其中：

- `runtime.route.describe(...)` 在 Phase 1 的 stable authority home 是 host typed surface。
- 本轮不得把 `describe(...)` 定义成 direct daemon convenience method，也不得要求 `new Runtime()` 必须具备与 daemon 顶层 RPC 一一对应的 `describe()`。
- `describe(...)` 相关类型和值域必须直接继承 `K-RPC-015` ~ `K-RPC-021`，不得在 SDK 再发明第二套 route metadata schema。
- Phase 1 host typed surface 若通过 `ExecuteScenario` 的 route describe probe
  承载 `describe(...)`，必须只解码 Runtime 写入的
  `x-nimi-route-describe-result` response metadata 并执行 typed result 校验；
  SDK/Desktop 不得把缺失 metadata 转换为默认值或根据 route binding 本地推断
  metadata。

## S-RUNTIME-075 Typed Describe Result Projection

SDK 稳定 typed result `RuntimeRouteDescribeResult` 必须保持以下公共字段：

- `capability`
- `metadataVersion`
- `resolvedBindingRef`
- `metadataKind`
- `metadata`

`metadata` 必须是 discriminated union，Phase 1 variants 继承
`K-RPC-017` 的完整 route metadata family：

- `TextGenerateRouteMetadata`
- `SpeechSynthesizeRouteMetadata`
- `SpeechTranscribeRouteMetadata`
- `VoiceWorkflowVoiceCloneRouteMetadata`
- `VoiceWorkflowVoiceDesignRouteMetadata`

字段和值域必须与 `K-RPC-017` 同形：

- `TextGenerateRouteMetadata.traceModeSupport` 只能是 `'none' | 'hide' | 'separate'`
- `SpeechSynthesizeRouteMetadata.supportedTimingModes` 只能包含 `'none' | 'word' | 'char'`
- `VoiceWorkflow*RouteMetadata.workflowType` 只能是 `'voice_clone'` 或 `'voice_design'`
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

## S-RUNTIME-077 Selection / Resolve / Health Host Projection Boundary

`runtime.route.listOptions(...)`、`runtime.route.resolve(...)`、以及
`runtime.route.checkHealth(...)` 在 Phase 1 的 app-facing stable home 是 SDK
host typed surface。该 surface 只能做 Runtime facts 的 deterministic projection，
不得成为新的 catalog、readiness、provider/model capability、fallback policy、
或 default route policy authority。

允许的 SDK projection 工作固定为：

- 对 Runtime 已投影的 local asset / provider catalog / connector catalog / capability
  record 做类型收窄、字段归一化和 fail-close 校验。
- 在已存在的 typed binding intent 或 Runtime-projected local asset record 上执行
  model-root normalization。
- 在 Runtime 已提供 engine / provider / capability evidence 时，派生 local route
  engine label；不得仅凭 Desktop raw provider/model/endpoint 猜测 engine。
- 基于 Runtime local catalog/readiness projection 选择 warm candidate；该选择只能
  用于同一已解析 local asset 的 warm-on-demand orchestration，不得替代
  `runtime.route.resolve(...)` 的 binding truth。
- 组装 app-facing resolved binding projection，但所有 resolved identity、health、
  readiness 和 capability truth 必须可追溯到 Runtime projection input。

禁止路径：

- 从 Desktop `runtimeFields`、endpoint 字符串、provider label、model label、
  local/cloud heuristic、或 connector 默认模型回填生成 execution route truth。
- 在 SDK 内维护 provider/model catalog、local engine catalog、readiness cache、
  fallback matrix、或 first-available default binding 作为 stable truth。
- 把 `listOptions` 的 option ordering 或 UI convenience selection 升级为
  execution fallback policy。
- 把 `checkHealth` 成功解释为 metadata 成功；metadata 仍必须走
  `runtime.route.describe(...)` 的 `S-RUNTIME-075` / `S-RUNTIME-076` 边界。

## S-RUNTIME-078 Runtime Client Projection Boundary

`@nimiplatform/sdk/runtime` 在 Phase 1 可以共享 `runtime.route.describe(...)` 的 typed result types，但不得把它包装成“新增 daemon 顶层 RPC 已存在”的公开承诺。

- 允许共享类型与 host facade interface。
- 不允许在 runtime client surface 上引入与 `K-RPC-020` 冲突的 transport 假设。
- 在 runtime transport authority 正式定稿前，route metadata 的 app-facing 成功路径以 host typed surface 为准；SDK 不得先行发明私有临时 API。
- route facade 可能被 host/runtime memory binding 解析路径复用作 legality /
  health dependency，但 `runtime.route.*` 本身不是 memory embedding editable
  config surface，也不是 canonical bank bind / cutover command surface。
