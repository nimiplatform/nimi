# Glossary

Cross-domain terms used across the public Nimi documentation. Each entry is
a reader-facing summary; precise authority lives in `.nimi/spec/**` and is
linked from the corresponding domain section.

## Platform And World Model

**Nimi.** An AI open world platform. Worlds, agents, applications, runtime
services, and identity share one social and semantic environment instead of
each app inventing its own private world model.

**World.** A long-lived semantic and social environment with its own rules,
participants, history, and presence. Anyone admitted as a world creator
can build a world; the platform supplies the cross-world contracts so
identity and meaning can move between worlds.

**Open World.** A world that is composable with other worlds through the
platform protocol. It isn't the same as "open source." It refers to
participation, identity portability, and shared semantics across worlds.

**Participant.** A first-class entity inside a world. People, AI agents,
and applications can each participate, but with different capability and
authority profiles.

**Six Protocol Primitives.** The fixed cross-world contract surface
defined by the platform protocol. Timeflow, Social, Economy, Transit,
Context, and Presence. Worlds may define their own internal rules, but
meaning that crosses worlds must fit these six contracts.

**OASIS Comparison.** Nimi compares itself to an OASIS-style world engine
in shape, not in content. OASIS is framed in spec as a physical world
engine; Nimi is a social and semantic world engine. Worlds rules are
creator-defined; the cross-world contract surface is fixed.

## Authority Domains

**Authority Domain.** A named owner surface (Platform, Runtime, SDK,
Desktop, Realm, Avatar, Cognition, Nimi Coding) responsible for a
specific kind of truth. A claim that crosses authority domains must be
admitted, not implied.

**Platform.** Owns the open world model, protocol primitives, and
authority rules.

**Runtime.** Owns AI execution: providers, workflows, streaming,
multimodal delivery, local capability routing, delegation, audit, and
runtime-owned agent participation.

**SDK.** The TypeScript app-facing access boundary. Apps consume Runtime,
Realm, world composition, scope, and shared public types through the SDK
rather than crossing private internals.

**Desktop.** The first-party native shell. Hosts native, local, and
first-party user workflows admitted by Desktop contracts.

**Web.** A constrained projection of selected platform surfaces. Does not
inherit Desktop-native capabilities by implication.

**Realm.** Owns semantic truth: world state, world history, chat, social,
economy, asset, transit, binding, and resource semantics. The public docs
describe the public read path; backend, dashboard, and creator-side
authority lives in private repositories and is not absorbed into the
public docs.

**Avatar.** Owns embodied agent presentation: embodiment projection,
carrier visual acceptance, and shell-specific rendering boundaries.

**Cognition.** Owns standalone memory, knowledge, prompt serving,
references, completion, skill service, and runtime bridge semantics.

**Nimi Coding.** The AI-coding governance workflow: topics, waves,
packets, preflight checks, audits, and closeout evidence.

## Runtime Vocabulary

**Workflow.** A governed multi-step execution graph owned by Runtime.
Has node types, state transitions, streamed events, and terminal outcomes.

**Streaming.** Runtime contract for partial and final delivery, including
stage boundaries, terminal frames, error semantics, and gating.

**Provider.** An external or local source of AI capability. Provider
identity and capability information is governed runtime data, not
marketing copy.

**Model Catalog.** The runtime-governed source of truth for model
identity, capability, and lifecycle status.

**Multimodal Artifact.** A non-text output (image, audio, video, voice,
music) produced under Runtime artifact contracts.

**Delegated Capability.** A Runtime-owned authority for forwarding
requests to external providers under firewall and approval contracts.

**Local Capability.** Runtime-owned routing, device profile, and engine
capability semantics for local execution.

## SDK Vocabulary

**Surface.** A named SDK public entry with its own export and boundary
contract. vNext examples include `@nimiplatform/sdk`,
`@nimiplatform/sdk/runtime`, `@nimiplatform/sdk/realm`,
`@nimiplatform/sdk/ai`, `@nimiplatform/sdk/ai-runner`,
`@nimiplatform/sdk/types`, and feature modules. Framework adapters are
independent packages.

**Boundary.** A spec-admitted import or call rule that prevents apps from
crossing into private Runtime, Realm, or Cognition internals.

**Projection.** A typed app-facing view of an underlying authoritative
contract. The projection does not redefine the contract; it exposes it.

## Realm Vocabulary

**Truth.** Canonical semantic facts about a world, owned by Realm.

**World State.** The current state of a world, governed by world-state
contracts.

**World History.** Past states and transitions, governed by world-history
contracts.

**Chat.** Realm-owned chat semantics when conversation participates in
world meaning.

## Desktop Vocabulary

**Shell.** Desktop's native first-party UI surface.

**Web Adapter.** The constrained projection of selected Desktop surfaces
into the browser. Native bootstrap, native window behavior, and sensitive
token persistence are disabled in this surface.

## Avatar Vocabulary

**Embodiment.** A governed presentation projection of an agent into a
visual or interactive carrier.

**Carrier.** The host surface that renders an embodiment under a typed
visual acceptance contract.

## Cognition Vocabulary

**Memory.** Long-lived participant context owned by Cognition.

**Knowledge.** Retrievable structured information owned by Cognition.

**Prompt Serving.** Cognition-owned authoritative prompt templates and
serving lanes.

**Runtime Bridge.** The seam through which Runtime can consume Cognition
without absorbing Cognition's authority.

## Nimi Coding Vocabulary

**Topic.** A governed work track for high-risk or authority-bearing work.

**Wave.** A bounded owner cut inside a topic. A wave isolates one closure
domain at a time.

**Packet.** The frozen execution contract for a wave, including allowed
reads, allowed writes, acceptance invariants, negative tests, and stop
lines.

**Preflight.** A stop-line check before a wave's implementation begins.

**Audit.** Evidence that the work matches authority and consumer needs.

**Closeout.** The decision that the work is actually done across all
closure dimensions.

**Closure Dimensions.** Authority closure, semantic closure, consumer
closure, and drift-resistance closure. A wave is closed only when all
four are satisfied.

**False Closure.** Output that looks complete by one closure dimension
while failing another. Common shapes: build passes but the page is
unreadable; the page is readable but lacks source authority; the route
exists but has no reader value.

## Posture And Compatibility

**Pre-Launch Posture.** The current public posture: the platform model is
documented; install commands, distribution channels, provider
availability, and model catalogs appear publicly only after the matching
evidence is admitted.

**Hard Cut.** A deliberate removal of a route or page rather than
preserving it as a hidden compatibility entrance.

**Selected Projection.** A locale or surface that intentionally exposes a
subset rather than mirroring everything. The public Chinese projection is
selected, not full-mirror.

## Source Basis

- [`.nimi/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/INDEX.md)
- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
- [`.nimi/spec/platform/kernel/tables/protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/protocol-primitives.yaml)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/sdks/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/index.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
- [`.nimi/spec/desktop/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/index.md)
- [`.nimi/spec/avatar/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/index.md)
- [`.nimi/spec/cognition/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/index.md)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
