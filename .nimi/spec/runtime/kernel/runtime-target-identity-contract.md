# Runtime Target Identity Contract

> Authority: Runtime Kernel
> Rule prefix: `K-RTARGET-*`
> Status: active hard-cut authority

## K-RTARGET-001 Scope

Runtime target identity is the durable identity layer used by AIConfig,
AIProfile execution, workflow AI nodes, memory embedding, route APIs, and AI
execution. It replaces durable identity based on raw `model_id`,
`target_model_id`, `localModelId`, `goRuntimeLocalModelId`,
`targetId/profileId`, or `connector_id + model_id`.

Connector identity remains credential custody only. Local runtime identity is
owned by local asset/profile readiness, not ConnectorService.

## K-RTARGET-002 Durable Target Refs

Durable refs are persisted intent. They must not contain runtime proof,
resolved endpoint paths, selected source evidence, execution metadata, or
display-only fields.

Local durable ref grammar is a required discriminated union:

```text
kind = local-runtime
version = v2
ref = profile_binding_id | readiness_ref
```

`profile_binding_id` and `readiness_ref` are mutually exclusive. Empty
local-runtime refs fail closed. `targetId`, `profileId`, `localAssetId`,
`assetId`, filename, path, digest, `localModelId`, `goRuntimeLocalModelId`, and
`model_id` are forbidden as durable local target identity.

Cloud durable ref grammar is:

```text
kind = cloud
version = v2
connector_id
remote_model_catalog_id
provider_model_id
provider
```

`connector_id` is credential custody. `remote_model_catalog_id` is the
Runtime-minted model target identity. `provider_model_id` is a provider/catalog
fact and is not sufficient to mint a durable target ref.

## K-RTARGET-003 Remote Model Catalog Identity

Runtime ConnectorService owns `remote_model_catalog_id` minting. The id must be
derived from a canonical snapshot containing connector id, connector snapshot
id, endpoint profile id, inventory snapshot id, provider, provider model id,
and capability.

Connector snapshot changes invalidate previously minted ids when provider,
endpoint, auth kind, provider auth profile, credential revision, provider
catalog version, or model/capability/availability inventory changes. Label-only
and display-only changes do not mint a new id.

A stale `remote_model_catalog_id` fails closed with
`AI_REMOTE_MODEL_CATALOG_STALE`. Missing cloud `remote_model_catalog_id` fails
closed with `AI_REMOTE_MODEL_CATALOG_ID_REQUIRED`.

## K-RTARGET-004 Shape Separation

The following shapes are distinct:

- Durable target refs: persisted intent for AIConfig/profile/workflow/memory.
- Inventory projection: UI/diagnostic target list with display, readiness, and
  compatibility facts.
- Resolved execution binding: runtime execution truth after target resolution.

`RuntimeTargetInventoryProjection` is a collection:

```text
RuntimeTargetInventoryProjection { capability, targets[] }
RuntimeTargetInventoryItem { target_ref, display, readiness, compatibility }
```

Resolved execution binding must be typed, must carry `route_metadata_ref`, and
must be exposed on execute/stream/describe surfaces. UI inventory must not be
persisted as execution truth.

## K-RTARGET-005 Local Import Identity

Every user file import mints a new installed `local_asset_id`. Duplicate
filename, duplicate bytes, duplicate digest, and duplicate
`asset_id + engine + kind` do not collapse user imports into an existing
installed record.

`asset_id` is catalog/template metadata for verified catalog assets. Display
name is editable and non-identity.

## K-RTARGET-006 Local Connector Retirement

Local connectors are retired. ConnectorService owns remote credential custody
only. `LOCAL_MODEL`, `CONNECTOR_KIND_LOCAL_MODEL`, `LocalConnectorCategory`,
and `Connector.local_category` must not remain active connector vocabulary.

Old wire/store records using raw numeric local connector values are quarantined
as retired records and must not project active connectors or target refs.

## K-RTARGET-007 Memory Embedding

Memory embedding durable binding uses the same v2 target ref grammar. Cloud
memory binding requires `remote_model_catalog_id + provider_model_id +
provider + connector_id`. Local memory binding requires the local durable ref
discriminant.

Provider/model/profile facts may appear only after resolution as resolved bank
profile facts. They are not durable target refs.

## K-RTARGET-008 Workflow, Voice, and RPC Execution

AI workflow node configs, voice workflow nodes, and admitted AI RPC request
surfaces consume v2 durable target refs or resolved binding inputs. Raw
`model_id`, `target_model_id`, and `connector_id + model_id` must not be
durable target identity.

If `model_id` or `target_model_id` remains for audit, provider execution,
catalog, model service, or voice asset compatibility, it is an
`allowed_non_identity_fact` and must be guarded so it cannot mint or persist a
durable target ref.

## K-RTARGET-009 Component Compatibility

Component compatibility is validated before warm, health, generate,
`StartLocalAsset`, lease/acquire, and resident load. Unknown compatibility
fails with `AI_LOCAL_COMPONENT_COMPATIBILITY_UNKNOWN`. Known incompatibility
fails with `AI_LOCAL_COMPONENT_INCOMPATIBLE`.

Compatibility errors must not collapse to slot-missing or generic local model
unavailable reason codes.

## K-RTARGET-010 Reason Code Governance

The following Runtime reason codes are admitted by this hard cut and must be
present in `tables/reason-codes.yaml`, `proto/runtime/v1/common.proto`,
generated clients, SDK constants, and error mappings before use:

| ReasonCode | Proto value |
| --- | ---: |
| `AI_LOCAL_CONNECTOR_RETIRED` | 317 |
| `AI_LOCAL_COMPONENT_COMPATIBILITY_UNKNOWN` | 378 |
| `AI_LOCAL_COMPONENT_INCOMPATIBLE` | 379 |
| `AI_REMOTE_MODEL_CATALOG_ID_REQUIRED` | 381 |
| `AI_REMOTE_MODEL_CATALOG_STALE` | 382 |
| `AI_MEMORY_EMBEDDING_TARGET_REF_INVALID` | 444 |

## K-RTARGET-011 Scan-Derived Classification Inventory

This inventory is the active G0/G12 classification source for
Runtime Target Identity v2. The current scan command is:

```powershell
rg -n "\b(model_id|target_model_id|connector_id|LOCAL_MODEL|targetId|profileId|localModelId|goRuntimeLocalModelId)\b" .nimi/spec --glob "!**/generated/**" --glob "!**/gen/**"
```

Every scan-hit file must be classified. Valid classifications are
`must_migrate`, `allowed_non_identity_fact`, `retired_history`, and
`unrelated_domain`. `allowed_non_identity_fact` rows must name the guard that
prevents durable target-ref minting. `must_migrate` rows are patch-owned by
this hard cut unless a downstream owner is explicitly named.

| Surface | Matched terms | Classification | Required action / guard |
| --- | --- | --- | --- |
| `.nimi/spec/avatar/kernel/agent-script-contract.md` | `model_id` | `unrelated_domain` | Avatar Live2D package id; not Runtime AI target identity. |
| `.nimi/spec/avatar/kernel/app-shell-contract.md` | `model_id` | `unrelated_domain` | Avatar app shell asset id; not Runtime AI target identity. |
| `.nimi/spec/avatar/kernel/avatar-event-contract.md` | `model_id` | `unrelated_domain` | Avatar event asset fact; not Runtime AI target identity. |
| `.nimi/spec/avatar/kernel/carrier-visual-acceptance-contract.md` | `model_id` | `unrelated_domain` | Avatar visual acceptance fact; not Runtime AI target identity. |
| `.nimi/spec/avatar/kernel/live2d-asset-compatibility-contract.md` | `model_id` | `unrelated_domain` | Live2D compatibility fact; not Runtime AI target identity. |
| `.nimi/spec/avatar/kernel/live2d-render-contract.md` | `model_id` | `unrelated_domain` | Live2D `*.model3.json` id; not Runtime AI target identity. |
| `.nimi/spec/avatar/kernel/tables/live2d-adapter-diagnostics.yaml` | `model_id` | `unrelated_domain` | Live2D adapter diagnostic fact. |
| `.nimi/spec/avatar/kernel/tables/live2d-adapter-manifest.schema.yaml` | `model_id` | `unrelated_domain` | Live2D adapter manifest field. |
| `.nimi/spec/desktop/kernel/ai-profile-config-contract.md` | `targetId`, `profileId`, `model_id`, `connector_id`, `localModelId`, `goRuntimeLocalModelId` | `must_migrate` | Patch Desktop AIProfile config authority to v2 refs. |
| `.nimi/spec/desktop/kernel/llm-adapter-contract.md` | `connector_id` | `allowed_non_identity_fact` | Remote credential custody only; G3/G9/G12 reject connector-only target identity. |
| `.nimi/spec/desktop/kernel/security-contract.md` | `connector_id` | `allowed_non_identity_fact` | Managed credential routing only; G3/G12 require remote catalog target identity. |
| `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` | `profileId` | `allowed_non_identity_fact` | AIProfile identity only; G4/G9 reject profile id as local-runtime target identity. |
| `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` | `profileId` | `allowed_non_identity_fact` | AIProfile identity only; G4 rejects profile id in local target refs. |
| `.nimi/spec/platform/kernel/nimi-first-party-integration-contract.md` | `profileId` | `allowed_non_identity_fact` | AIProfile apply reference only; G4/G9 require v2 AIConfig refs before execution. |
| `.nimi/spec/platform/kernel/nimi-home-contract.md` | `profileId` | `allowed_non_identity_fact` | AIProfile selection only; G4/G9 guard the AIConfig projection boundary. |
| `.nimi/spec/runtime/kernel/ai-profile-execution-contract.md` | `localModelId`, `model_id`, `connector_id` | `must_migrate` | Patch AIProfile execution and memory binding authority to v2 refs. |
| `.nimi/spec/runtime/kernel/audit-contract.md` | `model_id`, `connector_id` | `allowed_non_identity_fact` | Post-resolve audit facts only; G5/G8/G12 reject audit fields as target-ref inputs. |
| `.nimi/spec/runtime/kernel/authz-ownership.md` | `LOCAL_MODEL`, `connector_id` | `must_migrate` | Retire local connector ownership and route local auth through local asset/profile ownership. |
| `.nimi/spec/runtime/kernel/connector-contract.md` | `connector_id`, `model_id`, `LOCAL_MODEL` | `must_migrate` | Patch connector authority to remote credential custody only. |
| `.nimi/spec/runtime/kernel/index.md` | `connector_id` | `allowed_non_identity_fact` | Index navigation text only; linked authority files carry v2 semantics. |
| `.nimi/spec/runtime/kernel/key-source-routing.md` | `connector_id`, `model_id`, `target_model_id`, `LOCAL_MODEL`, `targetId`, `profileId`, `localModelId`, `goRuntimeLocalModelId` | `must_migrate` | Patch managed credential routing and cloud target identity separation. |
| `.nimi/spec/runtime/kernel/local-category-capability.md` | `connector_id`, `model_id` | `must_migrate` | Patch local connector/category identity text to v2 local refs or non-identity facts. |
| `.nimi/spec/runtime/kernel/local-profile-application-contract.md` | `model_id` | `must_migrate` | Patch raw local model routing and profile application text to v2 local refs or resolved non-identity facts. |
| `.nimi/spec/runtime/kernel/local-environment-consumer-activation-contract.md` | `model_id` | `allowed_non_identity_fact` | Catalog/route model selector only; G4/G12 reject it as durable local target identity. |
| `.nimi/spec/runtime/kernel/model-catalog-contract.md` | `model_id` | `must_migrate` | Patch remote catalog id minting and provider/catalog model id non-identity semantics. |
| `.nimi/spec/runtime/kernel/model-service-contract.md` | `model_id` | `allowed_non_identity_fact` | Catalog model identifier only; G3/G11 reject descriptor/model-service id as target ref. |
| `.nimi/spec/runtime/kernel/nimillm-contract.md` | `model_id` | `must_migrate` | Patch outbound validation to resolved binding/provider facts. |
| `.nimi/spec/runtime/kernel/pagination-filtering.md` | `LOCAL_MODEL`, `connector_id`, `model_id` | `must_migrate` | Patch local connector pagination and classify remaining list fields as non-identity. |
| `.nimi/spec/runtime/kernel/rpc-surface.md` | `model_id`, `target_model_id`, `connector_id` | `must_migrate` | Patch admitted AI RPC target inputs to v2 refs or resolved binding. |
| `.nimi/spec/runtime/kernel/runtime-memory-service-contract.md` | `connector_id`, `model_id` | `must_migrate` | Patch memory embedding durable binding to v2 refs. |
| `.nimi/spec/runtime/kernel/runtime-target-identity-contract.md` | `model_id`, `target_model_id`, `connector_id`, `LOCAL_MODEL`, `targetId`, `profileId`, `localModelId`, `goRuntimeLocalModelId` | `allowed_non_identity_fact` | This file is the classification and retirement authority itself; G12 parses this inventory and does not treat its listed forbidden vocabulary as active target identity. |
| `.nimi/spec/runtime/kernel/tables/key-source-truth-table.yaml` | `connector_id` | `allowed_non_identity_fact` | Credential custody table only; G3/G12 require remote catalog target identity. |
| `.nimi/spec/runtime/kernel/tables/metadata-keys.yaml` | `connector_id` | `allowed_non_identity_fact` | Credential routing metadata only; G3 rejects connector-only target identity. |
| `.nimi/spec/runtime/kernel/voice-contract.md` | `model_id`, `target_model_id` | `must_migrate` | Patch voice execution target inputs to v2 refs; keep asset compatibility only as guarded non-identity facts. |
| `.nimi/spec/runtime/kernel/workflow-contract.md` | `model_id`, `target_model_id`, `connector_id` | `must_migrate` | Patch workflow AI node configs to v2 refs or resolved binding inputs. |
| `.nimi/spec/sdks/kernel/ai-config-surface-contract.md` | `profileId`, `targetId`, `localModelId`, `goRuntimeLocalModelId` | `must_migrate` | Patch SDK core AIConfig authority and validators to v2 refs. |
| `.nimi/spec/sdks/kernel/connector-auth-acquisition-contract.md` | `profileId` | `allowed_non_identity_fact` | OAuth acquisition profile metadata only; G4/G12 reject it as local-runtime target identity. |
| `.nimi/spec/sdks/kernel/runtime-route-contract.md` | `localModelId` | `retired_history` | This file explicitly retires legacy route bindings and `localModelId`; G8/G12 reject them as route target identity. |
| `.nimi/spec/sdks/kernel/transport-contract.md` | `connector_id` | `allowed_non_identity_fact` | Credential/bearer routing only; G3/G12 reject connector-only cloud target identity. |
