# Voice Asset Lifecycle

> Status: Running today. Voice creation (clone + design) and the
> `VoiceAsset` runtime-managed object are shipped under the
> `K-VOICE-*` authority surface.

Voice in Nimi is a runtime first-class capability. Voice creation
(clone + design) and voice asset lifecycle are owned by Runtime under
`K-VOICE-001..K-VOICE-018`. This page covers the **asset side** —
what `VoiceAsset` is, how it is created, how it is referenced, and
how it differs from one-off speech synthesis.

## Voice Creation Scope

Voice creation covers two scenarios:

| Scenario | What it does |
| --- | --- |
| `voice_clone` | voice / audio → voice (sample-based) |
| `voice_design` | text → voice (description-based) |

Both are submitted through a unified `Scenario` abstraction:

- `SubmitScenarioJob` with `scenario_type=VOICE_CLONE`
- `SubmitScenarioJob` with `scenario_type=VOICE_DESIGN`

Provider-private parameters do **not** pass through freely; they go
through namespaced `ScenarioExtension` and are bound by extension
registry rules.

## VoiceAsset: Runtime-Owned Object Truth

`VoiceAsset` is the runtime-managed voice resource. Minimum required
fields:

| Field | Meaning |
| --- | --- |
| `voice_asset_id` | Runtime-owned asset id |
| `app_id` | Owning app context |
| `subject_user_id` | Owning user (tenant scope) |
| `workflow_type` | `voice_clone` / `voice_design` |
| `provider` | Backing provider |
| `model_id` | Provider model used at creation |
| `target_model_id` | Model the asset is bound to for synthesis |
| `provider_voice_ref` | Provider-owned native handle truth |
| `persistence` | Logical lifecycle (`persistence_types`) |
| `status` | Asset status (`asset_statuses`) |

Both `persistence` and `status` enums live in
`tables/voice-enums.yaml`.

`persistence` describes **logical** lifecycle and handle policy. It
does not automatically promise a durable local substrate; until
durable local substrate is admitted separately, locally-generated
`VoiceAsset` may remain a session-local orchestration object.

## Asset vs Reference vs Synthesis

This is the most important distinction on this page:

| Concept | What it is | Owner |
| --- | --- | --- |
| `VoiceAsset` | Durable runtime-owned voice resource | Runtime |
| `VoiceReference` | The handle a synthesis call uses to identify which voice to speak | Runtime |
| `provider_voice_ref` | The provider's native handle inside its API | Provider |
| Voice synthesis | One-off `tts_synthesize` invocation that uses a `VoiceReference` to produce audio | Runtime (RPC) |

`VoiceAsset` and `provider_voice_ref` must stay separate. Runtime
must not promote `provider_voice_ref` to a public primary key. The
provider must not bypass `VoiceAsset` to become the runtime's user
resource truth. When a provider returns a native custom voice handle,
the runtime converges it into the `VoiceAsset + VoiceReference`
public contract.

## VoiceReference Boundary

The synthesis entry point goes through `VoiceReference`. Only three
admitted reference kinds:

| Kind | Use |
| --- | --- |
| `preset_voice_id` | System-preset voice |
| `voice_asset_id` | User-created `VoiceAsset` |
| `provider_voice_ref` | Provider-native handle (admitted explicitly) |

The reference kinds enum lives in `tables/voice-enums.yaml`
(`reference_kinds`).

`VoiceReference` may be embedded inside the runtime-owned
`AgentPresentationProfile` as the agent's default voice binding. That
embedding does not transfer voice workflow / discovery / asset
ownership outside `K-VOICE-*`.

## Discovery: Two Separate Channels

Voice discovery splits cleanly into two channels:

| Discovery API | What it returns |
| --- | --- |
| `ListPresetVoices` | System-preset voice catalog |
| `ListVoiceAssets` | User's `VoiceAsset` records |

Callers must not depend on a single mixed API. When a provider
supports both global presets and user assets, both channels stay
available — but the runtime never returns mixed-stream results.

The `voice.discovery_mode` catalog setting binds discovery
responsibility:

- `static_catalog` → preset discovery only via `ListPresetVoices`
- `dynamic_user_scoped` → user asset discovery via `ListVoiceAssets`
- `mixed` → both channels active, callers invoke separately

## ScenarioJob Lifecycle

Voice creation is asynchronous. `ScenarioJob` lifecycle (state
machine + event stream) aligns with `K-JOB-002`. Voice does not
duplicate a parallel job state table.

The four lifecycle RPCs:

- `SubmitScenarioJob` — start a clone or design job
- `GetScenarioJob` — poll status
- `CancelScenarioJob` — cancel in flight
- `SubscribeScenarioJobEvents` — stream events

Provider-native multi-step workflows (e.g., `preview → create`)
**must** be encapsulated inside one `ScenarioJob` lifecycle. Provider
internal steps do not become extra public RPCs.

## Tenant Isolation

`VoiceAsset` is user-scoped by default. Cross-`app_id` or
cross-`subject_user_id` access fails closed. There is no implicit
cross-tenant voice asset reuse.

## Target Model Binding

`VoiceAsset` binds `target_model_id` at creation. If `tts_synthesize`
later requests a different target model, runtime returns
`AI_VOICE_TARGET_MODEL_MISMATCH`. The binding is contractual; it is
not an advisory hint.

## Voice Handle Policy

Workflow-capable voice families must declare
`voice_handle_policy` once admitted. Minimum fields:

| Field | Source |
| --- | --- |
| `persistence` | `tables/voice-enums.yaml` `persistence_types` |
| `scope` | `tables/voice-enums.yaml` `handle_scopes` |
| `default_ttl` | per-family |
| `delete_semantics` | `tables/voice-enums.yaml` `delete_semantics` |
| `runtime_reconciliation_required` | per-family |

Workflow-capable families without an admitted `voice_handle_policy`
may not be admitted.

## Reader Scenario: User Clones Their Voice

A user wants to clone their own voice for an agent.

1. **Submit clone job.** App calls
   `SubmitScenarioJob({ scenario_type: VOICE_CLONE, ... })` with the
   audio sample inputs.
2. **Job lifecycle.** Runtime executes through admitted
   `ScenarioJob` state machine; events stream via
   `SubscribeScenarioJobEvents`.
3. **Provider native preview / create wraps.** The provider's
   internal preview-then-create steps are encapsulated inside the
   one `ScenarioJob` — the app sees one lifecycle.
4. **Result.** Runtime emits a `VoiceAsset` with admitted fields and
   a `VoiceReference{ kind: voice_asset_id }`.
5. **Bind to agent.** App embeds the `VoiceReference` in
   `AgentPresentationProfile`. The agent now speaks with the cloned
   voice by default.

## Reader Scenario: Synthesis With A Preset Voice

App wants the agent to speak a one-off line using a preset voice.

1. **Discover.** `ListPresetVoices` returns the catalog with
   `preset_voice_id`s.
2. **Build VoiceReference.** `{ kind: preset_voice_id, value: ... }`.
3. **Synthesize.** Runtime `tts_synthesize` call uses the reference;
   no `VoiceAsset` is involved (no user asset is created).
4. **Audio bytes return.** Runtime owns the artifact bytes; Avatar's
   audio pipeline consumes via `runtime.artifacts.readBytes`.

Synthesis is transient. The `VoiceAsset` lifecycle is for **durable
voice resources** — a user's cloned voice, a designed voice, etc.

## Reader Scenario: Discovery Honors The Channel Split

App wants to surface the user's available voices in a settings UI.

1. **Two calls.** App calls `ListPresetVoices` for system voices
   and `ListVoiceAssets` for user-created voices.
2. **Render in two sections.** UI shows them as separate sections
   per the `discovery_mode` boundary.
3. **No mixed API.** App does not look for a single "list everything"
   call — there isn't one, and the channel split is contractual.

## What Voice Asset Lifecycle Does Not Do

- It is **not** a one-off synthesis call. `tts_synthesize` is
  transient; `VoiceAsset` is durable resource truth.
- It does not mix preset and user-asset discovery into one stream.
- It does not let providers escape into the public asset surface;
  `provider_voice_ref` stays inside `VoiceReference`.
- It does not silently cross tenants. User scope is fail-closed.
- It does not let workflow-capable TTS families substitute for STT;
  `audio.transcribe` admits independently per
  `K-VOICE-016` family-level boundary.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Voice creation workflows (clone + design) | Runtime (`K-VOICE-001..002`) |
| `VoiceAsset` object truth | Runtime (`K-VOICE-004`) |
| `VoiceReference` synthesis entry | Runtime (`K-VOICE-003`) |
| Provider-native voice handle | Provider (`provider_voice_ref`) |
| Tenant isolation | Runtime (`K-VOICE-006`) |
| Target model binding | Runtime (`K-VOICE-007`) |
| Discovery channel split | Runtime (`K-VOICE-009`, `K-VOICE-013`) |
| Voice handle policy | Runtime (`K-VOICE-015`) |
| Family-level workflow validation boundary | Runtime (`K-VOICE-016`) |

## Source Basis

- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`config/runtime-voice-enums.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-voice-enums.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
