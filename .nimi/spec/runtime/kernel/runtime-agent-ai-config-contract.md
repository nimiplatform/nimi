# Runtime Agent AI Config Contract

> Owner Domain: `K-AGCORE-*`

Runtime Agent AI Config authority, revision, readiness, turn admission, action projection, event seam, and bootstrap seeding authority.

This file is a semantic split from `runtime-agent-service-contract.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

## K-AGCORE-144 Runtime Agent AI Config Authority Home

`RuntimeAgentService` owns Runtime Agent AI Config: one runtime-owned,
agent-instance-scoped committed AI consume config that decides which binding
the local agent uses for chat, lifecycle, memory embedding, cognition,
activity/query, image generation, voice generation, voice workflows, and future
agent work capabilities. The admitted capability set, readiness states, typed
reason vocabularies, scopes, and forbidden derived-state fields live in
`tables/runtime-agent-ai-config.yaml`.

It owns:

- the single committed Runtime Agent AI Config record for each Runtime Local
  Agent instance
- per-capability committed AI consume intent (`text.generate`, `text.embed`,
  `image.generate`, `audio.synthesize`, `audio.transcribe`,
  `voice_workflow.voice_clone`, `voice_workflow.voice_design`, and future
  admitted `agent.work.*`)
- config mutation admission, validation, revisioning, and change event emission
- readiness projection derived from the committed config

It does not own:

- provider/model routing execution (`RuntimeAiService` per K-AGCORE-006)
- connector custody, key-source legality, or model catalog truth
- desktop `AIProfile`/`AIConfig` portable configuration authority for
  non-agent app AI consume (D-AIPC-001)
- resolved embedding dimensions, memory bank bind/rebuild/cutover state, voice
  stream state, voice artifact materialization, avatar lipsync/render state, or
  runtime activity events

Fixed rules:

- there is exactly one committed Runtime Agent AI Config per Runtime Local Agent
  instance; all first-party and binding-only consumers read and mutate that
  record through the admitted RuntimeAgentService RPC surface
- apps, SDKs, hosts, and cognition bridges must not persist a parallel copy of
  agent AI consume truth, re-derive it from `AIConfig` overlays at submit time,
  or carry it as per-turn request payload once K-AGCORE-147 applies
- binding values must use v2 durable target refs (`K-RTARGET-*`) or another
  spec-admitted typed binding reference; descriptor or evidence fields forbidden
  by K-AIEXEC-001 must be rejected fail-closed
- binding values are an alias-or-pinned union per capability: alias bindings
  reference admitted default target families such as `local/default`,
  `local/default-embedding`, capability-specific local defaults, or
  `cloud/default`; pinned bindings reference a concrete v2 target ref
- Agent Center `fixed` checkboxes are pure projection of alias-vs-pinned
  binding state. They do not add a persisted boolean field.
- product UI does not offer pinning for the `local` route or `text.embed` in
  this hardcut; the runtime contract remains neutral so later UI admission can
  widen presentation without changing the config record shape
- this config is agent-domain committed state, not a runtime-global active AI
  profile; K-AIEXEC-005 continues to hold for the generic profile resolve/apply
  layer
- mutation requires the `runtime.agent.ai_config.write` scope and read requires
  `runtime.agent.ai_config.read` (or an admitted first-party host equivalence);
  Platform registry scopes are not a substitute

## K-AGCORE-145 Runtime Agent AI Config Revision And Persistence

The committed Runtime Agent AI Config carries an `agent_instance_id`, monotonic
`revision`, the mutating app id, and the commit timestamp, and persists in the
runtime-owned store.

Fixed rules:

- every successful mutation increments `revision` by exactly one and commits
  atomically through the runtime persistence write path
- mutation requests must carry `expected_revision`; a mismatch is a typed
  concurrent-modification rejection, never a silent last-writer win
- the committed config must survive daemon restart; readiness is recomputed
  after restart rather than restored as stale truth
- every mutation emits an observable config-changed event before or together
  with the first read that reflects it; hidden mutation is not admitted
- config mutation and its evidence enter the audit trail (K-AUDIT-001)

## K-AGCORE-146 Runtime Agent AI Config Readiness Projection

`RuntimeAgentService` projects per-capability readiness for the committed
Runtime Agent AI Config. Readiness is a projection, not an execution gate or a
prepare/readiness substitute (K-AIEXEC-009).

Fixed rules:

- readiness state per capability is exactly one of `ready`, `not_configured`,
  or `unavailable`, with typed reason codes from
  `tables/runtime-agent-ai-config.yaml`
- `not_configured` (no committed binding for the capability) and `unavailable`
  (committed binding whose route is currently not usable) are distinct truths
  and must never be collapsed
- readiness recomputes at daemon start, on every config mutation, on default
  alias target changes, and on provider/route health change evidence; a
  startup-only probe that is never refreshed is not admitted
- readiness carries `config_revision` and probe timestamps so consumers can
  detect staleness; consumers must not cache readiness as their own truth
- readiness success does not admit an action, validate a prompt payload, or
  replace explicit profile prepare; execution-time enforcement remains
  fail-closed

## K-AGCORE-147 Turn Admission Consumes Runtime Agent AI Config Only

Agent turn execution binds to committed Runtime Agent AI Config at turn
admission time.

Fixed rules:

- Chat Track public turn admission resolves AI consume bindings from committed
  Runtime Agent AI Config; request-carried `execution_bindings`,
  `runtimeFields`, app `AIConfig`, or provider/model payloads are not admitted
  and must be rejected with a typed invalid-argument failure
- turn admission fixes the resolved bindings and the `config_revision` into the
  turn execution snapshot (K-AIEXEC-003); a config mutation during an in-flight
  turn affects the next turn only
- for alias-bound capabilities, the turn snapshot records the alias name, the
  resolved target ref, and the `config_revision`; a default-target mutation
  affects alias-bound agents on their next turn and does not affect pinned
  agents
- the conversation-anchor-sticky binding rule (anchor-committed bindings with
  mismatch rejection) is retired; anchors do not own binding truth
- Life Track, canonical review, chat-track sidecar, and companion participation
  executors consume the same committed Runtime Agent AI Config `text.generate`
  binding; runtime-private hardcoded model constants are not admitted as
  execution binding truth
- a missing required `text.generate` binding at admission is a typed
  fail-closed rejection, never a silent fallback to another route

## K-AGCORE-148 Available Actions Derive From Runtime Agent AI Config And Readiness

The action affordances offered to the model on a turn (including the APML
output contract prompt) derive from committed Runtime Agent AI Config presence
plus readiness, never from what a caller attached.

Fixed rules:

- image action availability on a turn is a tri-state derived at admission:
  available (committed binding, readiness not `unavailable`),
  `not_configured`, and `unavailable`
- the model-facing output contract must state the matching truth for the
  non-available states; telling the model an image route is unconfigured when a
  committed binding exists is not admitted
- planned actions whose capability is not available must fail as typed
  `action_failed` events with reason codes from
  `tables/runtime-agent-ai-config.yaml`; silent action drop or pseudo-success is
  not admitted
- voice generation, voice workflow, and embedding-dependent actions follow the
  same config-plus-readiness rule; Desktop, Zhiyu, and Avatar may display or
  render Runtime projections but must not generate voice, synthesize image
  provider truth, or persist embedding binding truth
- apps map typed reasons to product copy only; they must not re-derive action
  availability from app-local route state

## K-AGCORE-149 Runtime Agent AI Config Event Seam

Runtime Agent AI Config changes and readiness changes reach apps through a
dedicated runtime-owned subscription seam.

Fixed rules:

- config/readiness subscription delivers an initial snapshot followed by change
  events carrying `config_revision`
- the seam is domain-scoped; agent-scoped `AgentEvent` envelopes
  (K-AGCORE-037) must not be widened to carry domain config events
- subscription requires the same read authority as config read; events must not
  leak connector secrets, key material, or runtime-private descriptor evidence

## K-AGCORE-150 Runtime Agent AI Config Bootstrap Seeding

Runtime seeds Runtime Agent AI Config exactly once for a Runtime Local Agent
instance when no committed record exists.

Fixed rules:

- the seed commits `text.generate` bound to the runtime-owned local default
  alias (`local/default`, resolved per K-CFG-013 and `texttarget` resolution)
  and `text.embed` bound to the runtime-owned local embedding default
  (`local/default-embedding`, resolved through admitted runtime memory/cognition
  embedding execution)
- optional image, audio synthesize, and voice workflow capabilities are absent
  (`not_configured`) until explicitly configured
- seeding is a normal committed mutation: it produces revision `1`, an audit
  record, and a change event
- after seeding, a missing config row is an internal fail-closed error;
  turn-time silent fallback to bundled defaults is not admitted
- the seed must not overwrite an existing committed config, including after
  daemon upgrade or restart
