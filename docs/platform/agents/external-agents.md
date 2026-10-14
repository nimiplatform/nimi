# External Agent & Ecosystem Participation

External agents and third-party action integrations do not form part of the core LocalAgent execution engine today. Their absence does not constrain the system: local AI inference, LocalAgent conversations, long-term memory retrieval, speech synthesis, SDK interfaces, Nimi Home, Avatar rendering, and standard application capability workflows all function completely independently.

Where external ecosystem integrations are admitted, they adhere strictly to Nimi's core security invariants:
- External entities integrate either as an outside security principal with explicit scope boundaries, or as a read-only participant view.
- External integrations never become Character assets, LocalAgent instances, or owners of either entity, and they cannot usurp conversation lifecycles or introduce redundant platform-wide `Agent` abstractions.

All external inputs must cross through explicit, typed Runtime and SDK boundaries. Provider-native payloads, proprietary tool schemas, transport security tokens, and external execution logs do not become authoritative platform facts merely because a UI client is capable of rendering them.

Standard Nimi application development and execution do not require an external action execution plane.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
