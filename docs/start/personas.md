# Personas and Learning Paths

This guide provides targeted documentation paths based on technical background and project goals. Pages link across paths so you can explore related topics as needed.

## Newcomer Evaluator

If you are exploring Nimi for the first time and want to quickly understand its architectural positioning and use cases:

1. [Platform → Vision](/platform/vision) — Core mission, goals, and architectural principles.
2. [Platform → Core Protocols](/platform/protocol) — The cross-world contract surface that makes federated collaboration possible.
3. [Platform → Architecture](/platform/architecture/) — The system-wide architecture overview and boundary responsibilities.
4. [Nimi Coding → Overview](/nimicoding/) — The canonical-authority specification tooling used across the codebase.
5. [Reference → Glossary](/reference/glossary) — Terminology reference for key platform concepts.

Following this path gives you a solid grasp of Nimi's architecture and capabilities.

## World Creator

If you are designing and publishing a digital world (including rules, lore, Characters, and scenes):

1. [Platform → Vision](/platform/vision) — The concept and role of a digital world in Nimi.
2. [Realm](/realm/) — Authoritative state, entities, and historical trajectories.
3. [Reference → World Fields](/reference/world-fields) — Schema definitions and field specifications for worlds.
4. [Reference → Six Primitives](/reference/six-primitives) — Foundational contracts for cross-domain interaction.
5. [Realm → Creator Economy](/realm/creator-economy) — Economic models, digital assets, and value flows.

## App Developer

If you are building desktop or web applications with the Nimi SDK:

1. [Start → Create a Nimi App](/start/create-an-app) — Scaffold a modern developer application using App Tools.
2. [SDK → First AI Call](/sdk/first-ai-call) — Execute text generation using capability intents, letting Runtime manage local and cloud models.
3. [SDK → Overview](/sdk/) and [SDK → Boundaries](/sdk/boundaries) — Understand the public application boundary and module responsibilities.
4. [Platform → Use Kit in an App](/platform/kit/use-kit-in-app) — Integrate shared UI components, authentication, and AI configuration panels.
5. [Start → Use Nimi Lab](/start/use-nimi-lab) — Reference capability integrations and patterns in the official workbench.
6. [Start → Troubleshooting](/start/troubleshooting) — Diagnose and resolve common development issues.

## AI Agent Integrator

If you are connecting external or local AI agents as first-class participants:

1. [Platform → Vision](/platform/vision) — The philosophy of AI agents as equal participants.
2. [Platform → External Agents](/platform/agents/external-agents) and [Platform → Participation Authority](/platform/agents/participation-authority) — Security, capability models, and participation grants.
3. [Runtime → Delegated Capability](/runtime/delegated-capability) — Integration gateway, isolation, and output filtering.
4. [Reference → Agent Fields](/reference/agent-fields) — Schema definitions and interaction attributes for agents.
5. [Reference → State Machines](/reference/state-machines) — Session lifecycle and delegated provider state models.

## Specification Engineering & Tooling Adopter

If you want to bring specification-driven development and authority checks into your own engineering workflow:

1. [Nimi Coding → Overview](/nimicoding/) — Overview of authority tooling and its boundaries.
2. [Nimi Coding → Host Integration](/nimicoding/installation) — Managed project configurations and synchronization workflows.
3. [Nimi Coding → CLI Reference](/nimicoding/cli-reference) — Complete guide to authority commands and diagnostic tools.
4. [Reference → Anti-Patterns & Boundaries](/reference/forbidden-claims) — Architectural constraints and design guardrails.

## Auditor and Security Reviewer

If you are auditing system security, state ownership, or contract compliance:

1. [Reference → Authority Domains](/reference/authority-domains) — Authority mapping and state boundaries.
2. [Reference → Glossary](/reference/glossary) — Technical terminology alignment across subsystems.
3. [Nimi Coding → CLI Reference](/nimicoding/cli-reference) — Supported authority diagnostics and verification commands.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`.nimi/methodology/authority-authoring.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-authoring.yaml)
