# Multimodal

Multimodal work produces non-text artifacts. Runtime owns the
canonical input fields, the artifact shape, the adapter routing,
and the delivery gates. Apps display or consume artifacts; they do
not redefine artifact truth.

## Capability Surface

Runtime's multimodal contract covers:

| Capability | What it generates |
| --- | --- |
| Image | Raster images via image engines |
| Video | Video artifacts via video engines |
| Audio | Audio generation |
| Voice | Text-to-speech (`AI_TTS`), with voice cloning support (`AI_TTS_CREATE_VOICE`, `AI_TTS_SYNTHESIZE`) |
| Music | Music generation, including iteration support |

Each capability has admitted canonical input fields, an admitted
artifact shape, and admitted delivery gates. Apps can't invent a
new artifact MIME type or skip the delivery gate.

## Canonical Input Fields

Every multimodal request has a canonical typed input. Apps build
the input under the contract:

| Field | Purpose |
| --- | --- |
| Capability id | Which capability is being invoked |
| Provider context | Optional provider-specific extension |
| Resource references | Input resources (existing artifacts) |
| Generation parameters | Capability-specific parameters |

The canonical fields live in
`runtime/kernel/tables/multimodal-canonical-fields.yaml`. Apps
that produce off-contract input shapes fail closed at admission.

## Provider Async Task Lifecycle

Multimodal generations are typically long-running. Runtime models
them as **provider async tasks** with a typed lifecycle:

| State | Terminal? |
| --- | --- |
| `queued` | no |
| `running` | no |
| `succeeded` | yes |
| `failed` | yes |
| `expired` | yes (timeout-equivalent) |

Note the lower_snake casing (vs `ScenarioJob`'s UPPER_SNAKE).
Provider async tasks are normalization at the provider boundary;
the casing matches provider semantics.

### Async-to-ScenarioJob mapping

Provider async terminal states map deterministically into
`ScenarioJob` terminal states:

| Provider async state | ScenarioJob terminal |
| --- | --- |
| `succeeded` | `COMPLETED` |
| `expired` | `TIMEOUT` |
| `failed` | `FAILED` |

The mapping rule (`K-MMPROV-027`) is admitted; apps see one unified
shape across modalities.

## Artifact Normalization

Multimodal output lands as an **artifact** with typed canonical
fields. Apps consume artifacts through the artifact contract:

| Artifact field | Purpose |
| --- | --- |
| Artifact id | Stable identity |
| MIME type | From the contract, not guessed |
| Bytes / reference | Where to read the artifact |
| Provenance | Who produced it, under what request lineage |
| Delivery gate verdict | Whether the gate admitted delivery |

Artifact field admission lives in
`runtime/kernel/tables/multimodal-artifact-fields.yaml`. An
artifact missing a required field fails closed.

## Delivery Gates

A multimodal artifact does not automatically reach the app the
moment generation succeeds. The **delivery gate** decides when an
artifact is allowed to be delivered.

| Gate concern | Why it matters |
| --- | --- |
| Sensitivity classification | Some artifacts may need approval |
| Provenance | Provenance-incomplete artifacts may be quarantined |
| Schema validation | Off-contract artifacts fail closed |
| User policy | User preferences may gate delivery |

The runtime delivery gates table
(`runtime/kernel/tables/runtime-delivery-gates.yaml`) admits the
specific gates. Apps see the gate verdict; they do not bypass it.

## Music Iteration Support

Music generation admits an iteration model: an artifact can be
iterated under typed parameters to produce variations.

| Property | Value |
| --- | --- |
| Iteration kind | `MUSIC_GENERATE` (admitted under `K-MMPROV-*`) |
| Lineage | Each iteration references the previous artifact |
| Audit | Iterations recorded as part of workflow lineage |

Iteration is bounded by the admitted contract; apps can't invent
new iteration kinds at runtime.

## Multimodal Provider Depth (R16)

> Status: Running today. The multimodal provider contract sits
> downstream of provider capability profiles; it pins how providers
> participate in multimodal delivery beyond the gate verdict surface.

The multimodal provider contract describes how providers are bound,
profiled, and admitted into multimodal capability paths
(image / audio / video / file). The boundaries:

| Owned by provider contract | Owned elsewhere |
| --- | --- |
| Per-provider capability profile shape | Connector custody (`K-CONN-*`) |
| Provider lifecycle within delegated multimodal path | Workflow execution (`K-WF-*`) |
| Provider drift detection | Delivery gates verdict (`K-DGATE-*`) |
| Provider native parameter encapsulation | Public delivery surface |

Provider-native parameters do not pass through freely; they go
through namespaced extensions and are bound by the admitted
extension registry — same boundary that voice creation enforces.

## Delivery Gates Verdicts (R8)

When multimodal delivery happens, the runtime delivery-gates contract
emits a verdict. Verdicts include `accepted`, `quarantined`,
`rejected`, plus typed reason codes.

A `quarantined` verdict means: the artifact is held; it does not
flow to the consumer; the user sees the quarantine reason explicitly.
Quarantine reasons cover sensitivity classification, descriptor
drift, schema mismatch, prompt-poisoning detection, and more (see
`runtime/kernel/tables/runtime-delivery-gates.yaml`).

A `quarantined` verdict is NOT a transient state. It is a typed
terminal outcome until either:

- The user / admitted approver explicitly releases the artifact, or
- The flow is canceled

There is no silent retry that "fixes" quarantine.

## Voice Cloning Support

> Status: Running today. Voice creation (clone + design) and
> `VoiceAsset` lifecycle are shipped under `K-VOICE-*`.

The voice capability admits voice cloning + voice design under typed
contracts. Both creation paths run through a unified `Scenario`
abstraction:

| Scenario type | Direction |
| --- | --- |
| `VOICE_CLONE` | Audio sample → voice |
| `VOICE_DESIGN` | Text description → voice |

The synthesis-side capability operations:

| Operation | Purpose |
| --- | --- |
| `AI_TTS_CREATE_VOICE` | Create a voice profile from input audio |
| `AI_TTS_SYNTHESIZE` | Synthesize speech using an admitted voice profile |
| `AI_TTS` | Standard TTS using an admitted voice |

The runtime distinguishes durable voice resources from one-off
synthesis:

| Concept | Owner | Persistence |
| --- | --- | --- |
| `VoiceAsset` | Runtime | Durable (subject to admitted lifecycle) |
| `VoiceReference` | Runtime | Identifies which voice a synthesis call uses |
| `provider_voice_ref` | Provider | Provider-native handle (does not become public asset truth) |

For the full asset surface — discovery channel split, target model
binding, tenant isolation, voice handle policy, and the
`VoiceReference` boundary — see
[Voice Asset Lifecycle](/runtime/voice-asset-lifecycle.md).

## Reader Scenario: An Image Generation Workflow

An app generates an image with a long-running provider.

1. **Workflow node.** An `AI_IMAGE` node is part of a workflow.
2. **ScenarioJob created.** The node fans out to a `ScenarioJob`.
3. **Provider async task.** The provider returns a task id; state
   moves `queued → running`.
4. **Polling / streaming.** Runtime tracks the task. The workflow
   event stream emits external-async progress events.
5. **Task succeeds.** Provider state moves to `succeeded`. Per
   `K-MMPROV-027`, the `ScenarioJob` terminal becomes
   `COMPLETED`.
6. **Artifact delivery.** The image artifact has typed canonical
   fields, MIME type, provenance. The delivery gate validates
   schema, provenance, sensitivity. If admitted, delivery
   completes.
7. **App receives artifact.** Through the SDK's typed artifact
   shape. The MIME type came from the contract; the app does not
   guess.

What did **not** happen: the app did not get a free-form URL with
no provenance; the app did not see a guessed MIME type; the
artifact did not bypass the delivery gate.

## Reader Scenario: A Music Iteration

A user generates music and wants to iterate.

1. **First generation.** A music workflow runs; an artifact is
   produced.
2. **Iteration request.** The app issues an iteration with typed
   parameters referencing the original artifact.
3. **`MUSIC_GENERATE` admitted.** The iteration is admitted under
   `K-MMPROV-*`.
4. **Provider async lifecycle.** The iteration runs through the
   provider async lifecycle. State maps into `ScenarioJob`
   terminal as before.
5. **New artifact.** The iteration artifact references the
   original; lineage is preserved.

The iteration is a typed operation; lineage is structural, not
docstring.

## Reader Scenario: A Provider Async Task Expires

A long video generation hits its provider-side timeout.

1. **Provider state moves** from `running` to `expired`.
2. **Mapping.** Per `K-MMPROV-027`, `ScenarioJob` terminal
   becomes `TIMEOUT`.
3. **Workflow effect.** The node's workflow state moves to
   `FAILED` (or to a retry path under admitted retry policy).
4. **Audit.** The expiry is recorded with reason.

The app sees a typed `TIMEOUT` not a "request failed in some way";
the `ScenarioJob` terminal type tells the app what happened.

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`config/spec-frozen/runtime/tables/multimodal-canonical-fields.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/spec-frozen/runtime/tables/multimodal-canonical-fields.yaml)
- [`config/spec-frozen/runtime/tables/multimodal-artifact-fields.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/spec-frozen/runtime/tables/multimodal-artifact-fields.yaml)
- [`config/runtime-voice-enums.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-voice-enums.yaml)
- [`config/runtime-tts-provider-capability-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-tts-provider-capability-matrix.yaml)
