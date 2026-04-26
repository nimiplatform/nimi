# Live2D Companion Architecture

This guide explains the current Live2D companion carrier contract for readers.
For the product-root Runtime/Agent/SDK/multi-app substrate, read
[Agent Companion Core Protocol](./agent-companion-core-protocol.md). Normative
authority remains in `.nimi/spec/**` and admitted `apps/avatar/spec/**`; this
page is a correspondence guide, not a replacement for those specs.
For future extension dispositions across the whole companion substrate, read
[Agent Companion Design Memory Register](./agent-companion-design-memory-register.md).

## Carrier Shape

The companion line is a Runtime/SDK-driven agent surface with `apps/avatar` as
the first-party carrier for live embodiment. Runtime owns model-facing output,
conversation continuity, hook admission, transient presentation, emotion state,
and timeline truth. Desktop owns launcher, handoff, and chat-shell
orchestration. Avatar owns the app-local embodiment projection layer, NAS
handler runtime, shell behavior, current Live2D backend branch, and
carrier-visual proof.

The current product posture is hard cut:

- closed lifecycle reports are evidence only;
- product contracts must cite stable spec identifiers or carry normative text
  directly;
- mock fixtures are explicit development and test inputs only;
- missing runtime, auth, launch context, carrier resources, or admitted schema
  fields fail closed instead of reporting success.

Live2D and Avatar validate the companion chain as first-party carrier and
acceptance surface. They do not own APML, provider routing, SDK event semantics,
or multi-app protocol truth.

## APML Decision

The admitted APML baseline is the narrow active contract in
`.nimi/spec/runtime/kernel/agent-output-wire-contract.md`.

Public reactive chat APML admits `<message>`, sibling
`<action kind="image|voice">`, `<time-hook>`, and narrow `<event-hook>` shapes.
JSON model-output compatibility is not admitted. APML is model-facing syntax,
not an app-facing consumption contract; runtime must validate and project it
into typed `runtime.agent.*` families before first-party apps treat it as
product truth.

The previously proposed broad APML taxonomy is not active product authority.
Any future APML widening is redesign work that must land in `.nimi/spec/**`
before implementation topics use it.

## Correspondence Matrix

| Product claim | Reader section | Active authority | Owner | Parent gap | Topic-ref status | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| APML is the model-facing output wire contract; narrow APML remains the admitted baseline and malformed APML fails closed. | APML Decision | `.nimi/spec/runtime/kernel/agent-output-wire-contract.md` K-AGCORE-044 through K-AGCORE-048 | Runtime | GAP-001, GAP-012 | Stable spec anchor only | `pnpm exec nimicoding validate-spec-governance --profile nimi --scope all` |
| AgentActivity is a runtime-owned app-facing ontology, with Avatar-only backend mapping downstream. | Product Shape | `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` K-AGCORE-049; `.nimi/spec/runtime/kernel/tables/agent-activity-ontology.yaml`; `apps/avatar/spec/kernel/tables/activity-mapping.yaml` | Runtime, Avatar | GAP-012, GAP-015 | Stable spec/table anchors only | `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope all --check` |
| HookIntent is narrow; broad event broker, wildcard subscription, cancellable before-events, and general SDK app-event emission are deferred. | Product Shape | `.nimi/spec/runtime/kernel/agent-hook-intent-contract.md` K-AGCORE-040 through K-AGCORE-043; `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` K-AGCORE-050 | Runtime, SDK | GAP-001, GAP-012 | Stable spec anchors only | `pnpm exec nimicoding validate-spec-governance --profile nimi --scope all` |
| PresentationTimeline is runtime-owned timeline truth for the admitted voice/lipsync branch, but product completion requires later Runtime, SDK/Desktop, Avatar, and acceptance evidence. | Product Shape | `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` K-AGCORE-051; `.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml`; `apps/avatar/spec/kernel/live2d-render-contract.md` NAV-L2D-013 | Runtime, SDK, Desktop, Avatar | GAP-012, GAP-015 | Stable spec anchors only | `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope all --check` |
| Current emotion is transient runtime state, not persistent profile truth or renderer-local truth. | Product Shape | `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` K-AGCORE-038; `.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml` | Runtime | GAP-012, GAP-015 | Stable spec/table anchors only | `pnpm exec nimicoding validate-spec-governance --profile nimi --scope all` |
| Conversation continuity is explicit `ConversationAnchor` truth; same-agent fallback is not admitted. | Product Shape | `.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md` K-AGCORE-033 through K-AGCORE-035; `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md` D-LLM-070; `apps/avatar/spec/kernel/app-shell-contract.md` | Runtime, Desktop, Avatar | GAP-012, GAP-015 | Stable spec anchors only | `pnpm exec nimicoding validate-spec-governance --profile nimi --scope all` |
| `apps/avatar` is the first-party avatar carrier; Desktop orchestrates launch and handoff but does not own local Live2D/VRM carrier execution. | Product Shape | `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md` D-LLM-053 and D-LLM-059 through D-LLM-062; `apps/avatar/spec/kernel/index.md` | Desktop, Avatar | GAP-012, GAP-015 | Stable spec anchors only | `pnpm exec nimicoding validate-spec-governance --profile nimi --scope all` |
| Embodiment Projection Protocol maps runtime/SDK semantics into backend-neutral avatar-local cues before backend execution. | Product Shape | `apps/avatar/spec/kernel/embodiment-projection-contract.md`; `apps/avatar/spec/kernel/index.md` | Avatar | GAP-012, GAP-015 | Stable app-local spec anchors only | `pnpm exec nimicoding topic validate 2026-04-26-live2d-companion-docs-spec-crystallization-and-topic-ref-hygiene` |
| NAS is a creator-facing convention-based JavaScript handler runtime under the Avatar app boundary, not a runtime or desktop owner. | Product Shape | `apps/avatar/spec/kernel/agent-script-contract.md`; `apps/avatar/spec/kernel/tables/activity-mapping.yaml` | Avatar | GAP-012, GAP-015 | Stable app-local spec anchors only | `pnpm exec nimicoding topic validate 2026-04-26-live2d-companion-docs-spec-crystallization-and-topic-ref-hygiene` |
| Live2D is the current backend-specific branch and asset posture; asset licensing and package layout are Avatar app-local concerns. | Product Shape | `apps/avatar/spec/kernel/live2d-render-contract.md`; `apps/avatar/spec/kernel/carrier-visual-acceptance-contract.md`; `apps/avatar/spec/kernel/app-shell-contract.md` | Avatar | GAP-012, GAP-015 | Stable app-local spec anchors only | `pnpm exec nimicoding topic validate 2026-04-26-live2d-companion-docs-spec-crystallization-and-topic-ref-hygiene` |
| Local SDK Consumer Trust requires desktop-selected launch context, shared auth session, runtime-backed consume, and fail-closed revalidation. | Product Shape | `.nimi/spec/sdk/kernel/runtime-contract.md`; `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md` D-LLM-070; `apps/avatar/spec/kernel/app-shell-contract.md` | SDK, Desktop, Avatar | GAP-012, GAP-015 | Stable spec anchors only | `pnpm exec nimicoding validate-spec-governance --profile nimi --scope all` |
| The first-30-second demo boundary is launcher/orchestrator acceptance, not Avatar carrier canvas proof or voice/lipsync product completion. | Product Shape | `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md` D-LLM-070; `apps/avatar/spec/kernel/carrier-visual-acceptance-contract.md` | Desktop, Avatar | GAP-012, GAP-015 | Stable spec anchors only | Parent manager re-audit over real-path demo evidence |

## Reader Path

Read the specs in this order when auditing or extending the companion line:

1. `.nimi/spec/runtime/kernel/agent-output-wire-contract.md`
2. `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`
3. `.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`
4. `.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`
5. `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md`
6. `apps/avatar/spec/kernel/index.md`
7. `docs/architecture/agent-companion-design-memory-register.md`

Implementation topics should cite the active spec rows above. Lifecycle topic
reports may be used as evidence in topic closeouts, but they are not product
authority.
