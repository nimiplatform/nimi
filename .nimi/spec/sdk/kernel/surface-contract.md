# SDK Surface Contract

> Owner Domain: `S-SURFACE-*`

## S-SURFACE-001 SDK 子路径集合

公开 SDK 子路径固定为：

- `@nimiplatform/sdk`
- `@nimiplatform/sdk/runtime`
- `@nimiplatform/sdk/ai-provider`
- `@nimiplatform/sdk/realm`
- `@nimiplatform/sdk/scope`
- `@nimiplatform/sdk/mod`
- `@nimiplatform/sdk/types`

SDK 必须维持单一 package layout；公开子路径只允许在 `@nimiplatform/sdk` 包内投影，不得漂移为多 package 或多根布局。

其中 `@nimiplatform/sdk` 根入口是 app 级组合面与第一方 docs/examples 的推荐入口；子路径继续作为显式 low-level escape hatch 或专用 domain 入口保留。

执行命令：

- `pnpm check:sdk-single-package-layout`

## S-SURFACE-002 Runtime SDK 对外方法投影

Runtime SDK 对外方法投影按服务分组，方法集合必须与 `.nimi/spec/runtime/kernel/tables/rpc-methods.yaml` 对应服务对齐，采用 design 名称。服务完整列表与方法集合以 `tables/runtime-method-groups.yaml` 为唯一事实源（S-SURFACE-009），每个 group 独立追踪对齐状态与 phase。

app-facing route metadata / projection surface 是例外的 host-typed logical surface，遵循 `runtime-route-contract.md`（`S-RUNTIME-074` ~ `S-RUNTIME-078`），不得被误写成新增 daemon 顶层 RPC 投影。

当 `RuntimeCognitionService` / `RuntimeAgentCoreService` 进入 SDK 投影时，公开 surface 必须维持 runtime-owned authority cut：

- `runtime.memory.*` 仅投影 `RuntimeCognitionService` 中的 runtime-owned memory family
- `runtime.knowledge.*` 仅投影 `RuntimeCognitionService` 中的 runtime-owned knowledge family
- `runtime.agentCore.*` 负责 app-facing canonical agent control plane
- app-facing canonical agent memory write path 必须统一走 `runtime.agentCore.*`，不得漂移回 direct Realm memory mutation 或 provider-native memory API
- `@nimiplatform/sdk/realm` 不再承载 canonical agent-memory public helper；runtime-era app path 只能消费 `runtime.agentCore.*`

## S-SURFACE-003 Runtime SDK 禁用旧接口名

SDK 对外契约层禁止出现以下旧接口名：

- `listTokenProviderModels`
- `checkTokenProviderHealth`
- `TokenProvider*`

## S-SURFACE-004 Realm/Scope/Mod 稳定导出面

- Realm SDK 以实例化 facade 为唯一入口，不允许全局配置入口。
- Scope SDK 以 in-memory catalog + publish/revoke 语义为最小稳定面。
- Mod SDK 以 host 注入 facade + hook 客户端为最小稳定面。

## S-SURFACE-005 Realm 公开命名去 Legacy

Realm SDK 公开符号（类型名、service 名、公开方法名、property-enum 键名）必须使用规范命名，禁止暴露 legacy 命名。

- 禁止：`*2fa*` / `*2Fa*` / `*2FA*`、`Me2FaService`、`SocialV1DefaultVisibilityService`、`SocialFourDimensionalAttributesService` 等旧命名。
- 允许保留协议字面量（wire literal）用于与服务端契约对齐，例如路径 `/api/auth/2fa/*`、schema key `Auth2faVerifyDto`、枚举值 `needs_2fa`。
- 命名归一化必须在 codegen 层完成，不允许在公开 facade 层依赖 legacy → new alias 桥接。

执行命令：

- `pnpm check:sdk-realm-legacy-clean`

## S-SURFACE-006 App Realm Access Boundary

`apps/**` 中的生产代码访问 Realm 时只能通过以下两类入口：

- codegen 生成的 `realm.services.*`
- 经明确登记的 typed adapter 模块

禁止在 app 生产代码中直接：

- 调用 `realm.raw.request(...)` 或 `realm.unsafeRaw.request(...)`
- 传递字面量 `/api/...` 路径或 URL
- 使用 `fetch('/api/...')` 直连 Realm REST

例外必须收敛到显式 allowlist，并由仓库检查脚本追踪。

执行命令：

- `pnpm check:no-app-realm-rest-bypass`

## S-SURFACE-007 Raw Escape Hatch 命名硬切

- Realm SDK 不再公开 `realm.raw` 兼容别名；如确有未覆盖的底层场景，只允许显式 `realm.unsafeRaw` 命名。
- Runtime SDK 不再公开 `runtime.raw` 兼容别名；低层调用统一使用 `runtime.call(...)` 或显式 `runtime.unsafeRaw`。
- 公开 surface 不允许保留 legacy alias 作为“平滑迁移”层；未规范化合同必须通过 `unsafe` 命名暴露，避免被误读为稳定 typed API。
- 一旦 Realm-managed runtime grant 合同落地，bridge helper 必须直接调用生成的 typed service（`realm.services.RuntimeRealmGrantsService.issueRuntimeRealmGrant`），不得继续走 `realm.unsafeRaw.request(...)`。

执行命令：

- `pnpm check:sdk-unsafe-raw-usage`

## S-SURFACE-008 App-Facing Realm DTO 必须具名且可消费

第一方 app 直接消费的 Realm DTO 不得退化为匿名内联 object、`Record<string, never>` 或 `unknown` map；必须满足：

- 关键嵌套结构使用具名 schema，例如 agent profile DNA、friend list response、world/worldview 语义块。
- 生成后的 SDK `.d.ts` 必须允许 app 直接读取常用嵌套字段，不得要求先把返回值打回 `Record<string, unknown>` 再自行清洗。
- 回归门禁必须覆盖这些高频 DTO 和对应 operation 的生成结果。

执行命令：

- `pnpm check:sdk-generated-type-quality`

## S-SURFACE-009 Runtime 方法投影表治理

`tables/runtime-method-groups.yaml` 是 SDK 对外方法投影的结构化事实源，采用”显式维护 + 一致性校验”模式：

- 显式维护：表内只列当前 SDK 对外投影集合，不要求机械等于 runtime kernel 全量 proto 面。
- 一致性校验：每个 group 必须声明对应 runtime service，且方法名必须在 `.nimi/spec/runtime/kernel/tables/rpc-methods.yaml` 中可解析；校验脚本负责阻断漂移。

## S-SURFACE-010 Realm Dynamic Envelope Allowlist

Realm codegen 生成出的 `[key: string]: unknown` 字段不得默认为“可接受动态对象”。必须满足：

- 每个 unknown-map 字段都要进入显式 allowlist，并带上动态边界分类。
- 未登记的 unknown-map 视为 contract regression，必须回到 backend OpenAPI 命名建模或先补 allowlist 说明。
- allowlist 仅用于真正动态 envelope、metadata、patch/value、manifest 等边界；高频 app-facing 业务结构不得长期停留在 allowlist 中。

执行命令：

- `pnpm check:sdk-generated-type-quality`

## S-SURFACE-011 Runtime Stable AI Surface No-Struct

`@nimiplatform/sdk/runtime`、`@nimiplatform/sdk/ai-provider` 以及第一方 app 中对稳定 AI product surface 的消费，不得再把 typed runtime protobuf 输出降格回 `google.protobuf.Struct`、`Record<string, unknown>` 或 `asRecord(...)` 补锅解析。必须满足：

- stable sync 输出直接读取 `ScenarioOutput` oneof；
- stable async media/stt 输出直接读取 `GetScenarioArtifactsResponse.output` 中的 typed `ScenarioOutput` oneof；
- stable stream 输出直接读取 `ScenarioStreamDelta` oneof；
- stable text request 输出配置直接读取 typed `TextGenerateScenarioSpec.reasoning`，不得借由 `Record<string, unknown>` 或 metadata 影子字段传 reasoning 开关；
- stable text stream 消费必须保留 `reasoning` 与正文的独立分支，不得静默压平或并回 `text`；
- app-facing runtime convenience 与 ai-provider 不得再暴露 `fallback: 'allow' | 'deny'` 之类的产品语义 fallback 开关；
- stable helper 缺 typed output、artifact metadata 或 mime/result 字段时必须直接报错，不得再补默认 `artifactId`、`application/octet-stream`、`audio/wav` 或空 artifact 成功路径；
- relay/desktop 对这些稳定能力的消费不得再通过 `result.object`、`Struct.fields.*`、artifact bytes/mime 约定、或 `Record<string, unknown>` 恢复语义。

真正动态的 workflow/internal envelope、plugin/mod manifest、transport/error raw payload 仍可保留动态边界，但必须与稳定 AI product surface 明确分层。

执行命令：

- `pnpm check:runtime-stable-ai-output-typing`

## S-SURFACE-012 World Evolution Engine Logical Facade Placement

World Evolution Engine typed facade candidates are logical consumer surfaces, not a new SDK package root or a new Runtime RPC method-group family.

Placement rules:

- app-facing candidate facades land on existing SDK public composition surfaces governed by `S-RUNTIME-091` and `S-RUNTIME-092` through `S-RUNTIME-096`
- mod-facing candidate facades land on existing stable host-injected mod surfaces governed by `S-MOD-014`
- shared types may be re-exported through existing SDK public surfaces when they remain projection-derived and consumer-seam-only

The following are not admissible:

- a new `@nimiplatform/sdk/world-evolution-engine` stable subpath
- recording World Evolution Engine logical facades in `runtime-method-groups.yaml` as if they were daemon RPC parity
- treating host-injected facade shape as proof of host concrete API authority

## S-SURFACE-013 World Evolution Engine Selector-Read Stable Method Placement

World Evolution Engine selector-read stable methods must stay on existing public composition surfaces.

Allowed placement:

- app-facing selector-read methods on the SDK root composition surface governed by `S-RUNTIME-102`
- mod-facing selector-read methods on an existing stable host-injected mod surface governed by `S-MOD-015`
- shared selector / result / rejection / view type families on existing SDK public surfaces when they remain projection-derived helper types

Forbidden placement:

- a new SDK public subpath for World Evolution Engine
- `@nimiplatform/sdk/runtime` or `Runtime` class publication of selector-read methods as daemon convenience
- any `runtime-method-groups.yaml` entry that records selector-read methods as RPC parity
- any placement that implies host concrete API ownership or transport-owned semantics
