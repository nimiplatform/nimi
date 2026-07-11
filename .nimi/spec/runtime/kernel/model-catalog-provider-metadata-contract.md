# Runtime Model Catalog Provider Metadata Contract

> Owner Domain: `K-MCAT-*`

Source schema, provider onboarding, activation, source/infra boundary, and runtime metadata projection authority.

This file is a semantic split from `model-catalog-contract.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

## K-MCAT-011 Source Schema v3

Source-provider entries under `runtime/catalog/source/providers/` 必须在合并后使用 schema v3。核心结构固定为：

- `runtime`
- `models`
- `language_profiles`
- `sources`
- `voice_sets`（可选）
- `voice_workflow_models`（可选）
- `model_workflow_bindings`（可选）

其中：

- `runtime.inventory_mode` 必填，值域为 `static_source|dynamic_endpoint`
- 当 `runtime.inventory_mode=dynamic_endpoint` 时，`runtime.dynamic_inventory`
  必填
- 当 `runtime.inventory_mode=dynamic_endpoint` 时，`models`、`selection_profiles`
  与 `defaults.default_text_model` 都可以省略
- 当 `runtime.inventory_mode=static_source`、`runtime.runtime_plane=remote` 且
  任一 `models[]` row 声明 `text.generate` 时，source 必须以正整数声明
  `defaults.context_window_tokens`，或在每个 text row 上声明正整数
  `models[].context_window_tokens`。该值是 catalog review 明确接纳的保守
  request-capacity floor，不是 Runtime/provider/app 推测的通用默认值；model
  row override 优先于 provider source default，alias expansion 必须继承 canonical
  model 的同一值。

## K-MCAT-020 Single Catalog Layout

Catalog source 与 snapshot 采用单一目录布局：

- source：`runtime/catalog/source/providers/` source-provider entries
- snapshot：`runtime/catalog/providers/*.yaml`

Runtime 仅允许加载 `runtime/catalog/providers/*.yaml`。

## K-MCAT-021 Layered Provider Onboarding

Provider 纳入必须分层：

- `audio.synthesize` 是纳入基础门槛；
- `voice_workflow.voice_clone` / `voice_workflow.voice_design` 属于可选能力增量；
- 仅支持 synthesize 的 provider 不得被强制声明 `voice_workflow_models`；
- 云厂训练型 Custom Voice（长周期训练）在未形成跨 provider 强类型抽象前，必须标记为 deferred/provider extension。

## K-MCAT-022 Activation Guardrail

Catalog source 不得将未接入 runtime adapter 的 capability 或 workflow binding 标记为 active。
Runtime 实际可用性必须与 source/snapshot 激活面一致；未接入实现的 provider/capability/workflow 不得被 source 声明，也不得被路由执行。

## K-MCAT-025 Source Provider / Infra Provider Boundary

Source-provider entries under `runtime/catalog/source/providers/` 仅定义 source provider SSOT。
`nimillm`、`openai_compatible`、`volcengine_openspeech` 属于 runtime 基础设施 provider，只能在 runtime registry / routing 层存在，不得伪装成 source provider 能力声明。

## K-MCAT-027 Provider Runtime Metadata Projection

source provider 的非 scenario 元数据必须通过 source-provider entry 合并后的顶层 `runtime` 块维护，最少包括：

- `runtime_plane`
- `managed_connector_supported`
- `inline_supported`
- `default_endpoint`
- `requires_explicit_endpoint`
- `inventory_mode`

当 `inventory_mode=dynamic_endpoint` 时，source 还必须声明
`runtime.dynamic_inventory`，至少包括：

- `discovery_transport`
- `cache_ttl_sec`
- `selection_mode`
- `failure_policy`

provider 默认文本模型元数据只对 `inventory_mode=static_source` provider
继续由同一份 source provider SSOT 的 `defaults.default_text_model` 维护。

`runtime/internal/providerregistry/generated.go`、`tables/provider-catalog.yaml`、`tables/provider-capabilities.yaml` 都必须由该 source metadata 投影生成，禁止 spec 表反向充当 runtime endpoint/default endpoint/default text model 真相。

当 `inventory_mode=static_source` 且 source 已声明 `selection_profiles[text.general]` 时：

- reviewed text default truth 属于 `selection_profiles[text.general]`
- snapshot / registry `default_text_model` 只是 compatibility projection
- 过渡期允许 `defaults.default_text_model` 作为同值兼容字段保留
- 若 `selection_profiles[text.general]` 与 `defaults.default_text_model` 不一致，generator 与 freshness gate 都必须 fail-close

当 `inventory_mode=dynamic_endpoint` 时：

- snapshot / registry 仍必须投影 provider-level runtime metadata
- snapshot 可以不包含静态 `models`
- runtime `ListConnectorModels` 真相来自 live connector discovery，经
  source-authored dynamic inventory policy 过滤后返回
- `default_text_model` 与 `selection_profiles` 不再是 machine-default fallback
  truth
- 若 config `provider.defaultModel` 与 UI/route-selected live model 都缺失，
  runtime 必须 fail-close，并返回可执行 action hint

## Verification Anchors

- `K-MCAT-005` / `K-MCAT-006` / `K-MCAT-007`：`pnpm check:runtime-catalog-drift`、`pnpm check:runtime-provider-yaml-first-hardcut`
- `K-MCAT-018`：`pnpm check:runtime-video-capability-block-enforcement`
- `K-MCAT-022`：`pnpm check:runtime-provider-activation-alignment`
- `K-MCAT-024`：`pnpm check:runtime-provider-capability-token-canonicalization`
- `K-MCAT-027`：`pnpm check:runtime-provider-endpoint-ssot`
- `K-MCAT-030`：`pnpm check:runtime-selection-freshness`
