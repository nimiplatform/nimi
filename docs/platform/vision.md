<!-- nimi-docs: {"authority":["rule.nimi.platform.core-protocol.p-arch-001a","rule.nimi.platform.governance-release.p-gov-026-positioning"],"sources":["VISION.md"]} -->

# A Cross-Terminal AI Foundation

People move across multiple screens and tools every day, yet AI capabilities and personal context are usually siloed inside separate applications. Nimi is building a user-controlled AI foundation designed to span PC, Web, mobile, embedded devices, and smart homes. By connecting AI capabilities and authorized state through shared contracts, Nimi lets applications focus on real tasks while each device offers the most natural way to interact.

## Starting from Today's PC Runtime

Today, your PC Runtime serves as the execution hub for both Local and Cloud AI, while Nimi Home (currently hosted by Desktop) provides the local entry point and management experience. Native Desktop Apps connect through verified local Host sessions. After official login and Home confirmation, admitted Web and Android sources can also connect directly to your account-bound primary Runtime—so a phone or browser does not need to run its own Runtime.

In practice, this lets you step away from your desk and continue the same partner Conversation on another screen, or use a creative App in your browser to submit work and inspect results saved on the PC host. Because these surfaces talk to the same host, they share the state you have authorized on that machine, without implying cross-Runtime synchronization or granting access to another App's private work. (Current remote access uses a direct connection without relay fallback, and Android has a local development entry; distributed App Link support needs separate validation.)

## Clear Ownership of Capabilities and Data

You decide how capabilities run: choosing Local executes tasks on your Runtime host, while choosing Cloud sends only the context required for that request to your selected provider. Across the stack, capabilities and data stay with explicit owners rather than blending into a single black box:

- **Realm** owns ecosystem identity and shared resources.
- **Runtime** governs execution, Conversation, and access checks.
- **Cognition** manages per-Agent isolated long-term Memory (while Knowledge V1 does not yet expose a public read/write entry).
- **Apps** retain their own business workflows and private data.
- **Avatar** handles presentation.

## Looking Ahead: Extending to More Devices

Beyond desktops, browsers, and phones, Nimi aims to reach additional mobile platforms, embedded hardware, and smart-home endpoints—whether a device provides sensing and ambient interaction or carries out physical actions. AI companions, shared worlds, everyday utilities, and creative studios are all experiences that grow on this same foundation.

These additional device carriers, broader network coverage, extra Runtime hosts, and compute federation are future steps rather than current features. Before any new endpoint becomes a supported path, Nimi defines its role, permissions, state owner, resource limits, and disconnection behavior around real user tasks. For current availability and upcoming milestones, see the [roadmap](/platform/roadmap) and [integration guides](/start/).

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
