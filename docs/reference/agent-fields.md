# Character and LocalAgent Fields and Mapping Specifications

In Nimi's architecture, persistent character templates (Character) and active local runtime instances (LocalAgent) are cleanly decoupled, each belonging to dedicated authority domains.

## Core Concepts and Field Mappings

| Field / Concept | Authority Domain | Scope & Purpose |
| --- | --- | --- |
| **Character Reference** | Realm | Globally unique identifier and canonical definition of a character |
| **PersonaCharacter / WorldCharacter** | Realm | Character archetype: autonomous companion vs. in-world narrative NPC |
| **Character Source** | Realm | Structured package containing lore and personas used for local instantiation |
| **World Source** | Realm | Contextual world setting and environmental parameters |
| **LocalAgent ID** | Runtime | Unique identifier of the local operational instance |
| **ConversationAnchor** | Runtime | Persistent handle binding the agent's single, continuous conversation |
| **Long-Term Memory** | Cognition | Private memory bank mediated securely by Runtime |
| **Capability Intent** | Runtime | Declared model inference requirements, quotas, and execution routes |
| **Presentation Configuration** | Runtime | Durable appearance settings, voice bindings, and baseline demeanor |
| **Ephemeral Interaction State** | Runtime | Per-turn real-time interaction phase (`listening`, `thinking`, `speaking`) |
| **Renderer State** | Avatar App | Live2D / 3D VRM graphics pipeline state, vertex shaders, and joint transforms |

## Access Conventions and Scopes

Applications interact with agents using secure session scopes:
- **Session-Scoped Handles (`agentHandle`)**: Applications interact with companions via temporary handles issued by the supervised host, rather than hardcoding static internal IDs.
- **Least-Privilege Exposure**: Provider API keys, user private keys, and low-level sandbox transports remain shielded inside Runtime and are never exposed to frontend renderers.

## Dialogue Continuity

Each LocalAgent maintains a single conversation thread bound to its `ConversationAnchor`. Whether invoked from the main window, a quick drawer, or an application widget, interactions seamlessly append to this unified context, preserving behavioral continuity.

## Related Documentation

- [Conversation Anchor Deep Dive](/platform/agents/conversation-anchor)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
