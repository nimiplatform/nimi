# Runtime Agent Context Composition Contract

> Owner Domain: `K-AGCORE-*`

Runtime owns LocalAgent per-turn context compilation, provider-visible request
composition, deterministic budgeting, transcript and memory isolation, APML
output admission, and bounded public context projections.

This contract applies only to Runtime Agent Chat and other Runtime agent
executors that consume a materialized LocalAgent. Ordinary non-Agent Nimi Chat
`systemPrompt` authority is unchanged.

## K-AGCORE-154 AgentTurnContextManifestV1 And Acyclic Hashes

Before any provider call, Runtime creates one strict
`AgentTurnContextManifestV1` for the admitted turn. The manifest contains no raw
prompt or lane text and records:

- manifest and compiler schema versions;
- `local_agent_ref`, `conversation_anchor_id`, turn id, and request id;
- source snapshot, source, world, and materialization-context refs/hashes;
- resolved model route digest, catalog revision, context-window capacity,
  reserved output/safety/adapter tokens, and input budget;
- ordered lane summaries with lane id, authority owner, trust class, typed
  source refs, item/content hashes, allocation/use tokens, included item/turn
  counts, omitted/truncated counts, and typed omission/truncation reasons;
- tool/media capability digest;
- Runtime transcript head/tail identity and committed turn/item counts; and
- `contextContentHash`, `promptHash`, and `manifestInstanceHash`.

The three hashes are acyclic and domain-separated:

- `contextContentHash = H("nimi.runtime.agent-context-content/v1\0" + canonical
  ordered semantic lane content)`. Its input excludes request, turn, attempt,
  timestamp, provider request, credential, and all derived hashes.
- `promptHash = H("nimi.runtime.agent-provider-prompt/v1\0" + canonical final
  provider-visible role/content/tool serialization)`. Its input excludes
  provider request id, transport envelope, credential, response, and manifest
  instance data.
- `manifestInstanceHash = H("nimi.runtime.agent-context-manifest/v1\0" +
  canonical manifest without manifestInstanceHash)`. Its input includes
  agent/anchor/turn/request ids, source and world hashes, content/prompt hashes,
  route/catalog digest, budget use, and omission/truncation summary.

Equivalent frozen source, Runtime truth, catalog revision, transcript/memory
inputs, capabilities, and current turn produce identical lane order/content,
`contextContentHash`, and `promptHash`. A new request/turn instance changes
`manifestInstanceHash` without forcing content or prompt hashes to change. The
manifest and all three hashes are fixed before provider invocation and do not
drift during streaming, APML projection, action execution, cancellation, or
turn commit.

## K-AGCORE-155 Typed Source Compiler, Fixed Lanes, And Trust Boundaries

Runtime compiles typed snapshot and Runtime truth into this exact lane order:

1. `runtime_policy`
2. `output_contract`
3. `source_identity`
4. `source_behavior`
5. `world_context`
6. `relationship_context`
7. `source_knowledge`
8. `canonical_memory`
9. `conversation_history`
10. `capability_context`
11. `current_user_turn`

`runtime_policy` and `output_contract` are Runtime-authored system authority.
Source identity, behavior, world, relationships, and knowledge are validated
snapshot data. Canonical memory and committed transcript remain distinct
Runtime-scoped inputs. Capabilities and tools derive from Runtime
permission/config/catalog truth. The current turn is typed caller input. A
provider adapter may translate this composition to its wire format but must not
reorder lanes, change roles, omit mandatory semantics, or add policy/tool
authority.

The typed source compiler maps identity/presentation to stable identity items;
psychology, Persona style, interaction profile, traits, boundaries, cadence,
and admitted exemplars to behavior items; biography/knowledge/content profile
to knowledge items; and WorldCore, placement, scenes, entities,
relationships, timeline, and systems to world/relationship items. Every item
has a stable id, typed source path/ref, content hash, priority, trust class, and
token estimate. Runtime must not serialize arbitrary source JSON or free-form
maps directly as a provider role.

Source text remains data even when it asks to ignore policy, change role, call
a tool, expose memory, alter APML, or forge a manifest. It cannot change
Runtime policy, provider roles, tool/media permission, execution binding, or
output contract. Caller-supplied system/developer roles, raw LocalAgent prompt
or context, execution bindings, lane order, source/world override, tool schema,
or forged manifest fail before provider invocation. A typed source capability
describes the character; it does not authorize a real Runtime tool.

## K-AGCORE-156 Transcript, Memory, Budget, And Deterministic Truncation

Realm WorldCharacter and RealmPersona records remain source provenance only.
Materialization freezes their typed source input into an opaque Runtime
LocalAgent identity; it does not transfer conversation ownership to the source
record or presentation app. `OpenConversationAnchor` allocates both the opaque
Runtime-owned conversation anchor and its Runtime-owned thread identity before
the first turn. Desktop and Zhiyu consume those identities from Runtime
projections and cannot derive either identity from `sourceRef`,
`localAgentRef`, source kind, or app-local thread state. Repeated
materialization may create a different LocalAgent, while later Realm source
changes never rebase an existing materialized LocalAgent automatically.

Runtime's committed transcript is the only LocalAgent conversation history.
Every ordinary second and later turn loads committed user/assistant turns from
the selected Runtime `ConversationAnchor` even when the caller submits only the
current user input. Streaming partials, failed APML, failed/canceled turns,
repair attempts, app optimistic text, greetings not committed as turns, and
dialogue exemplars are not transcript. Follow-up turns use the same compiler;
there is no separate history path.

Canonical memory is a separate lane with its own scope, authority, provenance,
rank, and item hash. Memory cannot impersonate transcript or source fact;
source relationships and interaction-derived relationship/memory cannot
overwrite each other. All transcript and memory reads are bound to authenticated
account, `local_agent_ref`, and anchor. Different accounts, agents, or anchors
cannot leak transcript; agent-scoped canonical memory may cross anchors only
where the existing canonical-memory contract admits it. App id is not a
partition key. Restart must reload the same committed inputs and reproduce the
same composition under the same catalog/compiler versions.
Realm offline operation continues from the frozen source snapshot and
Runtime-local transcript, memory, relationship, and state without
rematerialization or source rebase.

Runtime reads context-window capacity from the actual resolved model catalog,
then reserves provider/adapter overhead, output tokens, and safety margin. It
allocates mandatory policy, output contract, source identity/core behavior,
required world/relationship baseline, capability metadata when present, and
the current user turn before optional content. Truncation removes whole typed
items only, in exactly this order:

1. oldest complete conversation-history user/assistant pairs;
2. lowest-relevance canonical-memory items;
3. optional dialogue exemplars;
4. optional biography/source-knowledge items; and
5. optional world/timeline/scene detail items.

Stable rank keys and item ids break equal relevance/recency ties. Character,
byte, or token-fragment truncation is forbidden. The manifest records required,
available, allocated, and used tokens plus every omitted/truncated item count
and typed reason. If mandatory lanes exceed capacity, composition returns typed
`context_capacity_exceeded`, emits no provider request, and performs zero
provider calls.

## K-AGCORE-157 Provider Composition, Media, Tools, And APML Fail-Close

Runtime alone creates provider-visible system, user, assistant, and tool roles
from the admitted context manifest. Provider credentials, transport ids, and
provider-private request fields are not context authority and are excluded from
the stable content/prompt hashes. Local and cloud routes must carry semantically
equivalent lane content; route adapters cannot weaken trust or output rules.

Tools come only from Runtime permission, capability, readiness, and Runtime
Agent AI Config truth. Source-declared capabilities never grant a tool. Current
turn media uses closed typed part and MIME schemas; unknown, malformed,
unsupported, or unauthorized media fails before context composition or provider
invocation. No adapter may coerce it to text, silently omit it, or report
pseudo-success.

Runtime-private APML is the mandatory `output_contract` lane and remains
governed by K-AGCORE-044..048. Runtime validates root, tags, attributes,
hierarchy, and typed payload before committing assistant text, actions, emotion,
voice, hooks, memory candidates, or events. Malformed or unknown APML is a typed
turn failure. Runtime/provider/app must not strip wrappers, repair XML, recover
Markdown/fenced output, fall back to JSON, infer missing semantics, or re-accept
rejected output. Provider call success without valid APML is not product
success. Runtime projections and action/voice/hook execution consume only the
validated result and cannot alter the turn's context hashes.

## K-AGCORE-158 Bounded LocalAgent Context Projections

The only public LocalAgent source/context outputs are the typed bounded
`LocalAgentSourceContextStatus` and `AgentTurnContextSummary` families.

`LocalAgentSourceContextStatus` may expose only:

- ready/state and typed reason code;
- source kind/ref/schema/content hash;
- snapshot schema version/hash and `captured_at`;
- world content hash and materialization-context hash; and
- coverage section states and counts.

`AgentTurnContextSummary` may expose only:

- ready/state and typed reason code;
- manifest/compiler versions and manifest/content/prompt hashes;
- source snapshot hash and safe source/world refs/hashes;
- ordered lane ids, lane status, and included/omitted/truncated counts;
- context budget, used tokens, and typed truncation summary;
- transcript turn, memory item, media, and tool counts; and
- route/catalog revision digest.

These projections never expose raw source/world/core/closure data, prompt or
lane text, private memory, transcript text, packet wrapper/proof/chunks,
provider request/response, credential, tool arguments/results, or a free-form
map. Unknown schema, enum, state, lane, or reason fails closed; SDK/Kit/apps may
display or aggregate the projection but cannot backfill, reinterpret, or cache
raw context as an offline success path. Production logs and evidence use the
same allowlist plus correlation ids and hashes, never the private inputs.

## K-AGCORE-159 Conversation Report Runtime Route Identity

Runtime is the only executor for a live LocalAgent conversation-report turn.
The route resolves through Runtime Agent AI Config and the Runtime model
catalog; an app or test runner cannot call a provider/model directly, supply an
execution binding, or embed a provider/model constant. One baseline run selects
one route and keeps it stable for both LocalAgents and every reported turn.

Each turn records a complete resolved route identity binding `providerId`,
`modelId`, and the resolved `modelRevision` or a stable catalog-derived model
fingerprint, plus the catalog revision and Runtime route digest available for
that call. Missing identity fields, an unresolved route, or silent route drift
is an objective execution failure. No evaluator or second route is required to
produce the report, and model identity never implies semantic quality.

- AUTHORITY-RELATION subject=runtime action=execute object=live-conversation-report-turn value=runtime-ai-execution polarity=require
- AUTHORITY-RELATION subject=conversation-report-turn action=bind object=runtime-model-fingerprint value=provider-model-revision-complete polarity=require
- AUTHORITY-RELATION subject=conversation-report-run action=keep object=selected-runtime-route value=stable-within-run polarity=require
- AUTHORITY-RELATION subject=app-or-test-runner action=call object=conversation-provider-or-model-directly value=denied polarity=forbid
- AUTHORITY-RELATION subject=app-or-test-runner action=supply object=conversation-provider-model-constant-or-binding value=denied polarity=forbid

## K-AGCORE-160 Conversation Report Capture Boundary And Non-Authoritative Review

Runtime retains the product-owned LocalAgent identity, conversation anchor,
transcript, memory, relationship, state, and hook lineage. The report pipeline
may capture their bounded public projections and the committed user/assistant
transcript with exact account, source snapshot, LocalAgent, anchor, turn,
surface, and model correlation. It cannot read raw system prompts, private
context lanes, credentials, proofs, or other Runtime-private inputs.

Report capture is observational: it cannot create or rewrite a product turn,
message, transcript entry, memory item, relationship update, LocalAgent,
snapshot, anchor, hook, action, or event. It performs no automatic provider
retry. A captured reply, optional annotation, or derived review note never
becomes source, snapshot, personality, memory, transcript, future context, or
an authoritative semantic verdict. Realm-offline turns continue from the
frozen LocalAgent source snapshot and Runtime-local state.

- AUTHORITY-RELATION subject=conversation-report-capture action=retain object=runtime-bounded-context-and-state value=required polarity=require
- AUTHORITY-RELATION subject=conversation-report-capture action=correlate object=localagent-anchor-turn-model-lineage value=complete polarity=require
- AUTHORITY-RELATION subject=conversation-report-capture action=read object=raw-system-prompt-or-private-context-lanes value=denied polarity=forbid
- AUTHORITY-RELATION subject=conversation-report-capture action=expose object=credential-proof-or-private-runtime-input value=denied polarity=forbid
- AUTHORITY-RELATION subject=conversation-report-execution action=retry object=provider-attempt value=denied polarity=forbid
- AUTHORITY-RELATION subject=conversation-report-capture action=commit object=product-turn-message-transcript-memory-localagent-state value=denied polarity=forbid
- AUTHORITY-RELATION subject=captured-behavior-observation action=become object=semantic-or-personality-truth value=denied polarity=forbid
