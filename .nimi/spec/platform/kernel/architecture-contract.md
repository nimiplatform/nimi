# Architecture Contract

> Owner Domain: `P-ARCH-*`

## P-ARCH-001 — 六层执行架构定义

Nimi 平台采用固定六层执行架构：nimi-realm（云端持久世界）、nimi-runtime（本地 AI 运行时）、nimi-sdk（开发者接口层）、desktop（第一方应用 / mod host）、nimi-hook（desktop mod 接口层）、mods（独立包/独立仓的扩展层）。`nimi-apps` 为独立应用总称。

`nimi-cognition` 作为独立 authority domain 存在，由 runtime / sdk bridge 与 consume；它不是第七条执行宿主层，也不得被 platform text 静默压回 realm 或 runtime 子章节。

public top-layer architecture text `MUST` 同时暴露 cross-repo read path：

- public canonical 入口在 `nimi/.nimi/spec/**`
- private realm / backend / dashboard / creator-side authority 保留在
  `nimi-realm/.nimi/spec/**`
- mods workspace authority 保留在 `nimi-mods/spec/**`

上述 framing 只负责 cross-repo topology 与 authority routing；不得把 private
repo 或 mods workspace 的 semantic owner 静默迁回当前 public root。

## P-ARCH-002 — 层间通信规则

`MUST`: Realm 与 Runtime 并列互不依赖，通过 SDK 桥接。App 通过 `@nimiplatform/sdk` 统一接入。Mods 通过 nimi-hook 访问能力。通信协议固定：Realm=REST+WS，Runtime=gRPC。

## P-ARCH-003 — Realm 职责边界

`MUST`: Realm 是持久世界的共享真相源。职责域：auth、social、chat、economy、world、agent、audit（云端）。

platform text `MUST NOT` 把 platform protocol 的六原语执行主权写成 realm
semantic core 的完整别名。六原语属于 platform primitive layer；realm semantic
persistence read path 继续落在 Truth / World State / World History / Chat 与其
相邻 formal domain surfaces。

## P-ARCH-004 — Runtime 职责边界

`MUST`: Runtime 是独立本地后台进程。职责域：AI 推理（全模态）、AI 路由（local/cloud）、进程管理、模型管理、Workflow DAG、GPU 仲裁、本地数据层、知识库、Credential Plane、MCP Server、审计（本地）、App 间通信、App 授权网关，以及 cognition / agent-core overlap 的 runtime-facing bridge surface。

## P-ARCH-005 — No-Legacy 执行口径

`MUST`: 架构口径固定为单一目标态。数据口径采用 reset-first。执行模式采用 AI-first。不引入长期双轨并存。

## P-ARCH-010 — V1 执行栈冻结

`MUST`: 本地模型面：llama + media + sidecar。远程模型面：nimiLLM。路由面：local | cloud 显式路由，不允许静默 fallback。凭证面：cloud 默认走请求期凭证注入。编排面：Workflow DAG 独立能力。实现语言固定 Go。

## P-ARCH-011 — Credential Plane 双平面

`MUST`: daemon-config plane（由 `ai.providers.*.apiKeyEnv` 驱动）与 request-credential plane（受信宿主请求期注入）不可在同一请求混用。Runtime 在 managed connector 路径下承担 `connectorId -> secret` 解析（`K-CONN-001` / `K-KEYSRC-004`），在 inline 路径下消费请求期凭据注入。

## P-ARCH-020 — SDK 统一入口

`MUST`: SDK 是开发者接入平台的唯一入口。Desktop 与第三方 app 用完全相同的 SDK API。Transport profiles: node-grpc, tauri-ipc, local-broker(FUTURE)。

## P-ARCH-021 — Desktop 定位

`MUST`: Desktop 是平台旗舰应用，架构上无特殊地位。独有特性：nimi-hook、Core UI、Runtime Console、App Store 入口。

## P-ARCH-022 — World Evolution Engine Placement

`MUST`: World Evolution Engine 被定义为跨 app / mod / domain consumer 的 shared execution layer。Platform kernel 只拥有其 placement、boundary、naming、packaging guardrails；execution semantics semantic owner 保留给 Runtime kernel 后续合同。

## P-ARCH-023 — World Evolution Engine 非 Owner 边界

`MUST NOT`: World Evolution Engine 不得被定义为 narrative feature shell、SDK semantic owner、Realm canonical truth owner、或 consumer-specific orchestration shell。Realm canonical truth、world state/history、以及 narrative domain truth 保持既有 owner 不变。

## P-ARCH-024 — World Evolution Engine SDK-Only Access

`MUST`: World Evolution Engine 对 Realm 与 Runtime 的跨层读取、控制、提交请求一律通过 SDK public surface 进行。

`MUST NOT`:

- 直接 import `runtime/internal/**`
- 直接依赖 Realm private client 或私有 transport
- 直接依赖 SDK private internals
- 通过 host bridge implementation detail、app-private client、或任意 private boundary import 绕过 SDK

任何需要上述 bypass 的 placement 一律视为 inadmissible。

## P-ARCH-025 — Admissible Placement Shapes

`MUST`: World Evolution Engine 仅允许以下 placement shape：

- Runtime semantic contract + SDK-mediated consumer seam
- Platform boundary text + Runtime semantic contract + optional adapter-driven consumer helper layer

`MAY`: `kit/**` 或等价 shared module 仅在保持 pure logic / consumer helper 性质、且不吸入 runtime / realm write authority、canonical truth ownership、或 private client dependency 时，作为 consumer-facing helper 承载默认接入面。

## P-ARCH-026 — Inadmissible Placement Shapes

`MUST NOT`: World Evolution Engine 的 placement 不得采用以下形态：

- 由 SDK 充当 shared kernel semantic owner
- App / Desktop / Web 直接持有 Runtime internal 或 Realm private access
- Mods 或 narrative-engine 直接耦合 shared kernel internals
- 通过 host-private bridge、app-local singleton、或 private client 形成第二条 control path
- 把 commit authorization、canonical history、canonical state、runtime audit、或 stable event truth 迁移为 shared kernel 的第二套 authority

## P-ARCH-027 — Consumer Boundary And Rewrite Hardcut

`MUST`: apps、mods、narrative-engine、以及其他 consumer 与 World Evolution Engine 的交互只允许通过 SDK public surface、host-injected facade、或显式 adapter / event boundary 完成。

`MUST NOT`:

- 通过 private boundary import 直接耦合 Runtime / Realm internals
- 在 app / mod / narrative consumer 各自重写 tick loop、replay semantics、checkpoint semantics、或 shared execution authority
- 让 `kit/**`、apps、mods、或 narrative-engine 吸入 write authority、commit authorization authority、或 canonical truth ownership

## P-ARCH-028 — Workflow Surface 非 World Evolution Engine Truth

`MUST NOT`: 现有 Runtime workflow DAG / task / node / output event surface 不得在 Platform placement text 中被提升为 World Evolution Engine 的 semantic owner、canonical naming source、或 stable event truth。

`MAY`: 现有 workflow/output event surface 仅可被视为 runtime-local partial reuse 候选，用于后续 Runtime contract 评估 stream shape、status vocabulary、或 adapter seams；其是否可复用以及复用到何处，必须由 Runtime kernel 后续合同显式决定。

## P-ARCH-029 — Consumer API Contract Home

`MUST`: World Evolution Engine 的 app/mod consumer-facing API contract 落点固定为 `.nimi/spec/sdk/kernel/**` 中的 downstream consumer seam contract。

该 contract 只拥有：

- app-facing SDK facade 与 mod host-injected facade 的 consumer composition boundary
- consumer read/observe surface 与 command/request surface 的 admissibility framing
- consumer-visible no-leak / no-widening / no-bypass hardcut

该 contract **不**拥有：

- Runtime execution semantics semantic ownership
- SDK projection-visible shape semantic ownership
- host bridge concrete API ownership
- app / mod / host implementation strategy ownership

因此：

- Runtime `K-WEV-*` 继续是 semantic owner
- SDK projection contract 继续是 projection-visible shape owner
- Platform kernel 只负责声明 consumer API 的正式落点与跨层 placement/boundary，不重写 consumer API 语义正文

## P-ARCH-030 — 审计双层模型

`MUST`: runtime 本地审计（AI 调用/模型操作/App 通信/授权链路）与 realm 云端审计（业务操作/合规）独立运行。本地审计可选上报云端聚合。

## P-ARCH-031 — World Domain Facade Placement

`MUST`: `sdk/world` is the app-facing world-domain facade for world truth
consume, world-input projection, world generation/materialization
orchestration, fixture package consume, renderer orchestration consume, and
world-session composition.

Boundary rules:

- `sdk/world` remains adjacent to Realm canonical world truth and Runtime
  provider execution; it does not replace either authority home.
- internal world-domain orchestration may factor into a dedicated core such as
  `nimi-world`, but that core must not become a second public platform entry.
- `sdk/world` is not a rename or public replacement of World Evolution Engine
  / `K-WEV-*`.
- `sdk/world` must not absorb renderer-driver implementation, provider-native
  request ownership, or shared-projection truth ownership.
