# RPC Surface Contract

> Owner Domain: `K-RPC-*`

Split authority map:

- `rpc-route-describe-contract.md`: K-RPC-015..023
- `rpc-local-service-contract.md`: K-RPC-004 and K-RPC-004-state
## K-RPC-000 Runtime Target Identity v2 Hard Cut

AI RPC request surfaces consume v2 durable target refs or resolved binding
inputs. Raw `model_id`, `target_model_id`, and `connector_id + model_id` are
not admitted durable target identity. Catalog RPCs may retain provider/catalog
model ids as non-identity facts.

## K-RPC-001 服务范围

Runtime kernel 的 RPC 覆盖范围为 admitted proto 服务与已定义的 design-first service surface：

**Phase 1（AI 执行平面 + Auth Core + Account Core）：**

- `AIService`（design 名称，映射到 proto `RuntimeAiService`）
- `ConnectorService`（design-first，proto 仍在迁移）
- `RuntimeLocalService`
- `RuntimeAuthService`
- `RuntimeGrantService`
- `RuntimeExternalAgentService`
- `RuntimeAccountService`（local first-party account session / scoped app binding 权威，方法集合见 `account-session-contract.md` `K-ACCSVC-002`，与 `RuntimeAuthService` 不重叠）

**Phase 2（完整 Runtime 服务）：**

- `RuntimeWorkflowService`（`K-WF-*`）
- `RuntimeAuditService`（`K-AUDIT-*`）
- `RuntimeModelService`（`K-MODEL-*`）
- `RuntimeCognitionService`（`K-MEM-*`, `K-KNOW-*`, `K-RPC-004a`）
- `RuntimeAgentService`（`K-AGCORE-*`, `K-RPC-004b`）
- `RuntimeAppService`（`K-APP-*`）

补充约束：

- `rpc-migration-map.yaml` 标记为 `design_only_no_proto_contract` 的 service 仍属于 design surface，不构成已 admitted 的 proto contract
- 设计态 service 进入 implementation-facing proto 前，仍受 `proto-governance-contract.md` 的 `K-PROTO-011` 约束

## K-RPC-002 AIService 方法集合（design 权威）

`AIService` 的 active method inventory、method type 与 proto mapping 只由
`tables/rpc-methods.yaml` 和 `tables/rpc-migration-map.yaml` 维护。本节只定义
scenario family 的 RPC 语义与边界，不维护第二份方法清单。

说明：

- text/image/video/audio 等多模态输入能力属于现有 scenario 的输入扩展，不新增顶层 `multimodal.generate` RPC
- `TEXT_GENERATE` 的多模态 uplift 继续复用 `ExecuteScenario` / `StreamScenario`
- 大媒体 upload-first ingress 通过 `UploadArtifact` 暴露，供 `artifact_ref.artifact_id` 在 `TEXT_GENERATE` 与 realtime 中复用
- duplex realtime session 不属于 `AIService`，统一走独立 `RuntimeAiRealtimeService`
- app-facing `runtime.route.describe(...)` metadata projection 由 `K-RPC-015` ~ `K-RPC-021` 约束；Phase 1 不得为其新增 daemon 顶层 RPC method

## RuntimeAiRealtimeService 方法集合

`RuntimeAiRealtimeService` 的 active method inventory、method type 与 proto
mapping 只由 `tables/rpc-methods.yaml` 和 `tables/rpc-migration-map.yaml`
维护。本节只定义 realtime session family 的 RPC 语义与边界。

说明：

- v1 realtime session 只为 text/audio 双向会话预留 contract，不承担 `video + audio -> video + audio`
- `ReadRealtimeEvents` 为 server-stream；duplex 语义通过 `Open + Append + Read + Close` 组合实现
- v1 provider-backed 实现范围固定为 llama text+audio session；其他 provider 未实现时必须 fail-close，不得伪装成 `AIService` 普通 scenario
- `RuntimeAiRealtimeService` 是独立 realtime multimodal session 面，不是 ordinary
  Runtime Agent voice output。agent 自定义音色语音输出必须走 scenario-layer
  `audio.synthesize`（`RuntimeAiService`）语义，不得直接把该 realtime session RPC
  当 agent voice output（边界见 `K-MMPROV-031`、`K-VOICE-019`、`K-AGCORE-133`）。
  其 `RealtimeAudioChunk` 只属于 realtime session 事件流，不是 scenario 语音流
  delta 或 agent voice stream chunk。
- `RuntimeVoiceService` 不是公共契约面（`K-VOICE-008`）；voice 对外方法收归
  `RuntimeAiService`。任何以 `RuntimeVoiceService` 命名的独立公共 service 均越界。

## K-RPC-003 ConnectorService 方法集合（design 权威）

`ConnectorService` 的 active method inventory、method type 与 proto mapping
只由 `tables/rpc-methods.yaml` 和 `tables/rpc-migration-map.yaml` 维护。本节只
定义 connector custody、catalog、overlay 与 credential shape 边界。

ConnectorService 当前与 proto `RuntimeConnectorService` 对齐（见 `tables/rpc-migration-map.yaml` 中 `mapping_posture=aligned`）。

ConnectorService 在 `CreateConnector` / `UpdateConnector` 上的 credential request shape 固定为：

- `api_key`：`auth_kind=API_KEY` 的 legacy-compatible field
- `auth_kind`：managed connector credential family discriminator
- `provider_auth_profile`：OAuth-managed connector 的 provider profile token；唯一事实源是 `tables/connector-auth-profiles.yaml`，并且必须与 provider 兼容
- `credential_json`：OAuth-managed connector 的 provider-defined sealed payload
- `credential_json` 在当前 admitted scope 只承诺被 runtime 当作 sealed
  payload 托管；RPC 面不承诺统一 refresh schema，也不承诺 runtime 拥有 OAuth
  login/refresh orchestration

这些字段只定义 connector custody 与 patch 语义，不等同于 app-facing inline credential metadata contract。

## K-RPC-026 RuntimeExternalAgentService 方法集合

`RuntimeExternalAgentService` 是 External Agent gateway / token ledger /
action registry / audit projection 的 Runtime-owned app-facing RPC surface。
Desktop、Web、Kit 与 apps 只能通过 SDK typed projection 消费该 service，不得
通过 Tauri、本地 SQLite、renderer-local registry 或 app-local HTTP server 维护并行
gateway/token/action/audit 真源。

`RuntimeExternalAgentService` 的 active method inventory、method type 与 proto
mapping 只由 `tables/rpc-methods.yaml` 和 `tables/rpc-migration-map.yaml`
维护。本节只定义 gateway / token ledger / action registry / audit projection
边界。

在 Runtime-owned action registry/server 尚未启用前，service 必须 fail closed：
status 返回 disabled / `EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY`，token issuance
与 revoke 以 structured Runtime error 拒绝，不得发出 host-local token、伪造
token mutation success 或伪造 action success。

## K-RPC-004a RuntimeCognitionService 方法集合

`RuntimeCognitionService` 是 runtime-facing cognition overlap 的唯一稳定
RPC 面。

`RuntimeCognitionService` 的 active method inventory、method type 与 proto
mapping 只由 `tables/rpc-methods.yaml` 和 `tables/rpc-migration-map.yaml`
维护。本节只定义 memory / knowledge / admitted memory-embedding runtime
families 的 RPC 语义与边界。

固定约束：

- `RuntimeCognitionService` 取代 `RuntimeMemoryService` 与
  `RuntimeKnowledgeService` 作为唯一 runtime-facing cognition service
  topology
- public surface 只暴露 Nimi-owned typed contract；provider-native API truth、
  cognition internal storage、以及 runtime-private review/bank/replication
  truth 均不得外露
- memory embedding runtime intent / inspect / bind / cutover family 属于
  `RuntimeCognitionService` 中 admitted 的 Runtime-owned host-local typed
  surface；SDK、Kit、Desktop 与 apps 只能提交 typed request 或消费 typed
  projection，不得拥有第二份 memory embedding 配置或 cutover 真源
- `Working memory` 不属于 `RuntimeCognitionService` 方法范围
- public app-facing 路径只服务 infra scopes；canonical scopes 通过
  runtime-private typed path 由 runtime-owned owner 消费
- `Reflect` 被明确退休，不再属于 steady-state public RPC；canonical review
  仍由 `RuntimeAgentService` 与 retained runtime-private memory depth 拥有
- absorbed memory/knowledge 方法族必须保留 fail-close 语义；不得以
  adapter-first 方式重新引入 dual-owner public surface
- host product 若需要 memory embedding resolved state、canonical bind、rebuild、
  或 cutover command，必须通过 admitted `RuntimeCognitionService` typed
  method 或 Runtime implementation-internal typed path；这不构成 SDK、Kit、
  Desktop、Tester 或其它 apps 的配置/绑定/cutover authority

Access posture is table-owned by
`tables/runtime-rpc-auth-posture/agent-ai-cognition.yaml`. Runtime-owned
internal callers may use runtime-private typed paths only where the service
implementation admits them; app-facing public authz must not be bypassed by
SDK, Kit, Desktop, Tester, or other apps.

## K-RPC-004b RuntimeAgentService 方法集合

`RuntimeAgentService` 是 runtime-owned live agent substrate 的唯一稳定
design RPC 面。

当前 implementation-facing proto transport 必须直接对齐
`RuntimeAgentService`；`RuntimeAgentCoreService` 不再是 admitted transport
name。design/proto 关系以 `tables/rpc-migration-map.yaml` 为准。

`RuntimeAgentService` 的 active method inventory、method type 与 proto
mapping 只由 `tables/rpc-methods.yaml` 和 `tables/rpc-migration-map.yaml`
维护。本节只定义 agent lifecycle、conversation anchor、companion
participation、delegation, avatar debug, presentation, state/autonomy/hooks,
agent memory, group-message candidate, and event family boundaries.

固定约束：

- agent canonical memory write policy 固定由 RuntimeAgentService 拥有
- agent canonical memory bank status/bind 的 app-facing projection 固定由
  `RuntimeAgentService` 拥有；SDK/app 不得从 memory embedding config、
  runtime-private inspect state、或 raw `GetBank` 组合 canonical bank mode
- apps 可以控制与消费 agent，但不得拥有 renderer-local agent truth
- proactive life scheduling 通过 typed HookIntent + host-owned admission 执行
- hook trigger detail、agent memory recall result、以及 failure/reschedule/budget-related agent events 必须使用 typed runtime messages，而不是自由 JSON payload
- app-facing state mutation contract 必须是 constrained command / patch family，而不是任意 agent-state blob replacement
- account-scoped source/profile and binding mutation require canonical durable
  mutation-event grammar on the runtime spec path, but this landing does not by
  itself expand the current public RPC method family
- app-facing reactive chat consumption does not add a second
  `RuntimeAgentService` RPC method family; the admitted transport seam is the
  reserved `runtime.agent` app-message target governed by `K-APP-008`
- agent voice native non-final chunk bytes use
  `RuntimeAgentService.SubscribeAgentVoiceStream` as the admitted typed
  data-plane for `K-VOICE-019`; presentation projection events only carry
  stream identity / transport refs and must not embed raw chunk bytes or mint
  per-chunk durable artifacts.
- agent voice playback interruption uses
  `RuntimeAgentService.InterruptAgentVoicePlayback`; it is a voice-stream
  lifecycle command and must not be collapsed into `runtime.agent.turn.interrupt`
  or app-local playback stop.
- current multi-agent admission is limited to durable delegation lifecycle and
  attribution visibility; it does not by itself admit delegated-authority trust
  semantics
- `turn` / `stream` terminal-coupling and temporal-autonomy deferral remain
  part of the canonical RuntimeAgentService authority cut even when they do not
  add new public RPC methods yet

Access posture is table-owned by
`tables/runtime-rpc-auth-posture/agent-ai-cognition.yaml`; app-message access
for the reserved `runtime.agent` chat seam remains defined separately by
`K-RPC-004c`.

## K-RPC-004c RuntimeAppService reserved `runtime.agent` chat access matrix

`RuntimeAppService` 保留 `runtime.agent` reactive chat seam 的最小 access
matrix 固定为：

- `SendAppMessage` 发往 `to_app_id=runtime.agent` 且消息类型属于
  `K-APP-008` admitted ingress family：`runtime.agent.turn.write`
- `SubscribeAppMessages` 订阅中 `from_app_ids` 包含 `runtime.agent`：
  `runtime.agent.turn.read`
- generic cross-app `SendAppMessage`（非保留 `runtime.agent` seam）：
  `runtime.app.send.cross_app`

## K-RPC-005 Design 名称与 Proto 名称映射

`tables/rpc-migration-map.yaml` 是 design/proto 命名映射的唯一事实源。
本轮 AI 入口与 proto 对齐为场景协议命名（`ExecuteScenario` / `SubmitScenarioJob` 等），不再维护 Voice 独立服务映射。

## K-RPC-006 对外契约禁用名

以下名称只允许出现在实现层或迁移映射表，不允许作为对外契约名：

- `GenerateText`
- `StreamGenerateText`
- `SynthesizeSpeech`
- `ListTokenProviderModels`
- `CheckTokenProviderHealth`
- `SubmitMediaJob`
- `GetMediaJob`
- `CancelMediaJob`
- `SubscribeMediaJobEvents`
- `GetMediaResult`
- `SubmitVoiceJob`
- `GetVoiceJob`
- `CancelVoiceJob`
- `SubscribeVoiceJobEvents`
- `StreamGenerate`
- `SynthesizeSpeechStream`

## K-RPC-007 CreateConnector 字段契约

`CreateConnector` 必须满足：

- 请求体不暴露 `kind`；`CreateConnector` 成功创建的结果 `Connector.kind` 固定为 `REMOTE_MANAGED`
- credential shape 必须满足二选一：
  - `auth_kind=API_KEY`（或省略并走 legacy path）时，`api_key` 必填且非空
  - `auth_kind=OAUTH_MANAGED` 时，`provider_auth_profile + credential_json` 必填
- `api_key` 与 `credential_json` 不得同时出现
- `endpoint` 为空时按 provider 默认值注入
- `label` 为空时使用默认 label
- 成功写入时 `status=ACTIVE`，`created_at=updated_at=now`

## K-RPC-008 UpdateConnector 字段契约

`UpdateConnector` 必须满足：

- 至少一个可变字段（`endpoint/label/api_key/status/auth_kind/provider_auth_profile/credential_json`）
- `status=UNSPECIFIED` 非法
- `api_key`、`credential_json` 与 `label` 显式空串非法
- 切换 auth kind 时必须提供目标 auth shape 所需字段；服务端不得做隐式 credential family 转换
- 合法请求一律刷新 `updated_at`

## K-RPC-009 DeleteConnector 补偿契约

`DeleteConnector` 必须满足：

- 级联删除 credential
- 执行 `DELETE_PENDING` 补偿流程（可重试、可启动恢复）

## K-RPC-010 Remote 探测/发现前置校验契约

- `TestConnector(remote)` 出站前必须通过 owner/status/credential 校验
- `ListConnectorModels(remote)` 必须只读 active catalog snapshot，不得出站，也不得承担 endpoint 探测

## K-RPC-011 Connector 状态机锚点

`tables/state-transitions.yaml` 中 connector 相关状态机（`connector_status` 与 `remote_connector_delete_flow`）必须以本 Rule ID 作为来源锚点。

## K-RPC-012 Connector Model Catalog Read Semantics

`ListConnectorModels` 的 remote 读路径固定为：

- 数据来源：active catalog snapshot
- `force_refresh=true`：允许但必须是 no-op
- 返回结果：不得因为 provider live `/models` 差异而改变
- `TestConnector(remote)`：是唯一保留的非 scenario 出站探测入口，但其结果不得回填 `ListConnectorModels`

## K-RPC-012a Catalog Provider Model Browsing Surface

`ListCatalogProviderModels` and `GetCatalogModelDetail` MUST expose runtime model catalog truth after overlay merge, scoped to the caller subject user when identity is present.

- `ListCatalogProviderModels(provider, page_size, page_token)` returns provider metadata plus effective model summaries for one provider
- `GetCatalogModelDetail(provider, model_id)` returns one effective model detail projection from the resolved provider catalog
- provider metadata returned to desktop MAY include overlay presence, overlay timestamps, effective YAML, default endpoint facts, runtime plane facts, and source classification
- model metadata MUST classify each model row as `builtin`, `custom`, or `overridden`

## K-RPC-012b Catalog Overlay Mutation Surface

`UpsertCatalogModelOverlay` and `DeleteCatalogModelOverlay` are the stable structured mutation RPCs for personal catalog models.

- `UpsertCatalogModelOverlay(provider, model, voices?, voice_workflow_models?, model_workflow_binding?)` MUST validate against the runtime model catalog schema before activation
- capability-conditional validation remains fail-close at mutation time, including TTS `voice_set_id` and video `video_generation`
- overlay mutations are user-private unless the runtime is explicitly operating on a shared non-subject custom root
- `DeleteCatalogModelOverlay(provider, model_id)` MUST delete only the targeted overlay entry and restore the built-in effective model when one exists

## K-RPC-012c Advanced YAML Editing Scope

`ListModelCatalogProviders`, `UpsertModelCatalogProvider`, and `DeleteModelCatalogProvider` remain valid as advanced YAML operations.
When used by desktop catalog UX, these RPCs MUST target provider overlay fragments rather than full effective provider snapshots.

## K-RPC-013 ListPresetVoices 字段契约

`ListPresetVoices` 返回 provider 预置声音列表。

**请求字段**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `app_id` | string | 是 | 应用标识 |
| `subject_user_id` | string | 是 | 鉴权主体用户 ID |
| `target_ref` | RuntimeDurableTargetRef | 是 | v2 durable target ref or resolved binding input |
| `voice_asset_target_ref` | RuntimeDurableTargetRef | 否 | 目标声音资产兼容绑定（克隆/设计场景可选） |
| `connector_id` | string | 否 | post-resolve credential custody fact only; not durable model identity |

**响应字段**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `voices` | repeated PresetVoice | 预置声音列表 |
| `model_resolved` | string | 路由后模型 ID |
| `trace_id` | string | 请求追踪 ID |

**PresetVoice 字段**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `preset_voice_id` | string | 预置声音唯一标识 |
| `name` | string | 声音显示名称 |
| `lang` | string | 默认语言标签 |
| `supported_langs` | repeated string | 支持语言列表 |

**约束**：

- 结果为有界小集合，不分页（无 `page_size`/`page_token`）。
- 请求必须经过 key-source 解析（`K-KEYSRC-*`），`connector_id` 语义与其他 AI RPC 一致。
- 声音来源遵循 catalog 主路径，不允许无命名空间自由透传参数绕过。
- Voice 资产（用户克隆/设计声音）不由本接口返回；由 `GetVoiceAsset` / `ListVoiceAssets` 管理。

## K-RPC-014 Voice Asset 管理方法集合

Voice 相关资产生命周期收敛到 `AIService`：

1. `GetVoiceAsset`
2. `ListVoiceAssets`
3. `DeleteVoiceAsset`
4. `ListPresetVoices`

## K-RPC-024 RuntimeLocalService Local Environment Plan Surface

`RuntimeLocalService` owns app-facing projection and command surfaces for local
environment plans. These surfaces are downstream of `K-LENG-024` through
`K-LENG-027`; they must not create a second dependency truth owner.

Required logical operations:

1. Read host capability profile.
2. Resolve local environment plan for a requested local compute pack,
   capability, model install, model import, or repair request.
3. Read local environment dependency graph and selected source record
   projection.
4. Confirm dependency materialization when network or heavy setup is required.
5. Start, observe, cancel, retry, and repair Runtime-owned dependency jobs.
6. Project activation gate status for native engines and Python pipelines.

The concrete transport may use new RPC methods or extend existing
`RuntimeLocalService` local plan/job projection, but the public semantics must
preserve these constraints:

- cloud-only reads and Cloud API setup must not resolve or start local compute
  dependency materialization
- plan resolution is allowed to inspect Runtime-owned host capability evidence
  but must not trigger download or install
- first network materialization requires explicit confirmation or a surrounding
  model/capability install confirmation that clearly names the covered
  dependency families
- selected source records are Runtime truth; SDK and Desktop receive bounded
  projection only
- dependency job projection must include enough state to distinguish
  `needs_confirmation`, `queued`, `downloading`, `verifying`, `installing`,
  `ready_system`, `ready_managed`, `repair_required`, `failed`, `unsupported`,
  and `cancelled`
- no Desktop, SDK, engine, or app-level REST bypass may execute installers,
  probes, source selection, PATH mutation, or pseudo-ready projection on behalf
  of this surface
- activation gate projection exposes the logical operation
  `ResolveLocalEnvironmentConsumerActivation`; request, response, audit
  envelope, and reason-code semantics are owned by
  `local-environment-consumer-activation-contract.md`

## RuntimeLocalService Materializer Projection Surface Anchor

Detailed RuntimeLocalService materializer projection semantics are owned by
`K-RPC-025` in `local-environment-materializers-contract.md`; detailed
activation-gate projection semantics are owned by
`local-environment-consumer-activation-contract.md`. This section remains the
stable RPC Surface anchor and delegates read, confirmation, command, job
observation, activation-gate, and no-ordinary-user-installer rules to those
files.
