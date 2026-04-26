# Agent Output Wire Contract

> Owner Domain: `K-AGCORE-*`

## K-AGCORE-044 Agent Model Output Wire Authority Home

`RuntimeAgentService` owns the model-facing output wire contract for reactive
agent chat turns and runtime-private agent executors.

For the Live2D companion substrate continuation, the admitted model-facing wire
format is APML inline markup.

It owns:

- APML tag admission for agent chat and runtime-private executor model output
- APML parser validation and fail-close semantics
- mapping from APML semantic units into runtime-owned typed projections
- the boundary between model-facing wire syntax and app-facing durable events

It does not own:

- renderer-local interpolation or animation physics
- desktop-local prompt UI wording
- provider-specific hidden formatting hacks
- app-facing raw parser event consumption

Fixed rules:

- public reactive chat APML admits only `<message>`, sibling
  `<action kind="image|voice">`, `<time-hook>`, and `<event-hook>` top-level
  tags
- the admitted public `<message>` body is user-visible text plus optional
  `<emotion>` and `<activity>` cues; `<emotion>` projects only to
  runtime-owned current emotion state, and `<activity>` projects only to the
  admitted runtime activity ontology
- public `<action>` admits only `<prompt-payload kind="image|voice">` with a
  required `<prompt-text>` child; video, provider-specific parameters, and
  renderer/backend-specific action controls remain outside this APML dialect
- public chat APML does not admit direct motion, expression, look-at, pose,
  speech-prosody, surface-routing, notification, tool, chain-of-thought,
  memory-write, posture/status, hook-cancel, namespace extension, mod
  extension, or parser-event syntax
- public `<event-hook>` is admitted only for the narrow HookIntent v1 event
  subset: `event-user-idle` with a positive `idle-for` / `idle-for-ms` duration
  or `event-chat-ended`; it must carry `<effect kind="follow-up-turn">`
- strict single-object JSON message-action output is not admitted as a
  model-facing wire authority for this continuation line
- model-facing JSON compatibility, fenced recovery, wrapper stripping, or
  best-effort JSON repair must not be retained; JSON may only exist as
  runtime-internal typed transport / persistence serialization after APML has
  already been validated and projected
- model output must be interpreted into typed runtime projection families before
  first-party apps treat it as product truth
- malformed APML must fail closed with observable turn failure and must not
  leave a turn in an uncommitted pending state
- closed broad APML designs are evidence only; any future public APML widening
  for direct presentation controls, prosody, routing, notification, tools,
  memory/state mutation, namespaces, video actions, or raw `apml.*` events
  requires a new mounted runtime authority packet before implementation

## K-AGCORE-045 APML To Runtime Projection Boundary

APML is a model-facing input contract. It is not the durable app consumption
contract.

The durable app product path remains:

- `runtime.agent.turn.*`
- `runtime.agent.presentation.*`
- `runtime.agent.state.*`
- `runtime.agent.hook.*`

Fixed rules:

- APML text content may become committed assistant message text only after the
  runtime turn commit point
- APML activity / expression / posture / status cues may only become product
  truth through the admitted runtime presentation and state projection families
- broad APML presentation capabilities such as motion, expression, look-at,
  pose, speech prosody, and voice/lipsync timing are product semantics only
  after they are represented as typed runtime projection families; their
  presence in closed APML evidence does not admit public model-facing syntax
- APML hook tags may only propose `HookIntent`; runtime owns validation,
  admission, scheduling, and public hook lifecycle events
- apps must not consume raw `apml.*` parser events as their durable product path
  unless a later mounted rule explicitly admits such events
- APML parser diagnostics may exist for debugging, but they must not replace
  typed runtime event envelopes

## K-AGCORE-046 Post-Turn Action And Hook Split

APML may express immediate post-turn modality requests and deferred hook
proposals, but those semantics have different owners after runtime validation.

Fixed rules:

- immediate `image` and `voice` requests may project into post-turn action
  indications after the assistant message commit point
- `video` remains deferred unless a later mounted packet admits video execution
  and consumer semantics
- deferred continuation must be represented as runtime-owned `HookIntent`; it is
  not a desktop message-action modality
- runtime must reject unsupported or owner-mismatched APML tags rather than
  silently translating them into local timers, hidden actions, or best-effort UI
  side effects

## K-AGCORE-047 Runtime-Private Executor APML Hard Cut

Runtime-private model executors must use APML extraction documents as their
model-facing output contract.

Admitted root documents:

- `<message>` for reactive public chat assistant turns
- `<life-turn>` for Life Track hook execution
- `<chat-track-sidecar>` for Chat Track sidecar execution
- `<canonical-review>` for canonical review execution

Runtime-private roots are root-specific dialects under this rule, not synonyms
for the public chat APML vocabulary. The admitted private vocabulary includes:

- `<behavioral-posture>` with posture-class/action-family/interrupt-mode,
  transition reason, truth basis ids, and optional status text
- `<canonical-memory-candidates>` with typed candidate payload children
- `<next-hook-intent>` with one admitted trigger child (`<time>`,
  `<event-user-idle>`, or `<event-chat-ended>`) and a follow-up-turn effect

Fixed rules:

- every admitted root must have a single APML root document and must begin with
  that root tag after whitespace trimming
- unknown tags, unknown attributes, duplicate attributes, unsupported
  parent/child hierarchy, text in non-text container tags, XML namespaces,
  comments, processing instructions, code fences, prose wrappers, and multiple
  roots must fail closed
- runtime-private APML output may propose posture, status, canonical memory
  candidates, hook intents, hook cancellations, narratives, truths, or
  relations only inside the root-specific admitted shape
- APML output is not durable product truth; RuntimeAgentService must validate
  and project it through runtime-owned typed admission paths before committing
  events, hooks, memory, posture, or review outcomes
- no runtime-private executor may retain JSON model-output compatibility or
  silently downgrade invalid APML into success

## K-AGCORE-048 APML LLM Compliance Harness

APML LLM compliance is an enforcement posture, not only prompt wording.

The admitted compliance boundary is:

- first-party prompts may teach only admitted public APML shapes;
- runtime parsers remain the authority for acceptance or rejection;
- invalid model output must fail closed with diagnostics and no placeholder
  success;
- executable negative tests are required for every admitted dialect class that
  can be confused with legacy JSON, prose wrappers, or another APML dialect.

Public chat compliance must cover:

- successful `<message>` output with admitted message children;
- successful sibling image/voice `<action>` output;
- successful narrow `<time-hook>` and `<event-hook>` HookIntent proposal output;
- rejection of JSON model-output compatibility;
- rejection of prose wrappers, Markdown/code fences, comments, processing
  instructions, directives, XML namespaces, duplicate attributes, unknown
  attributes, unknown tags, invalid hierarchy, and multiple competing hook
  triggers;
- rejection of runtime-private roots such as `<life-turn>`,
  `<chat-track-sidecar>`, and `<canonical-review>` on the public chat path.

Runtime-private compliance must cover each K-AGCORE-047 root-specific dialect
separately. A private root is never a synonym for the public chat vocabulary.

Fixed rules:

- prompt-only compliance is not sufficient for closeout;
- provider-specific hidden formatting, grammar hacks, or constrained decoding
  may be added only by later explicit authority and must not weaken parser
  fail-close semantics;
- parsers must not strip wrappers, repair malformed XML, recover fenced APML,
  or translate invalid output into a best-effort success envelope;
- Desktop or SDK consumers must not re-accept model output that runtime would
  reject on the same admitted path;
- compliance tests must exercise both success and negative cases before a
  dialect widening can be closed.

## Fact Sources

- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`
- `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`
- `.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`
- `.nimi/spec/runtime/kernel/tables/agent-activity-ontology.yaml`
- `docs/architecture/agent-companion-core-protocol.md` — reader guide and APML / runtime projection correspondence
- `docs/architecture/live2d-companion.md` — reader guide and APML decision correspondence
