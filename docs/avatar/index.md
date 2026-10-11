# Avatar

Nimi Avatar governs the multimodal presentation and embodied interaction of AI agents—whether in desktop transparent windows, virtual stages, or interactive viewports. The guiding architectural principle is simple: **presentation may adapt across carriers, but the Agent itself remains unique and continuous**, never fragmenting into an isolated identity merely because a renderer or host changes.

## What an Avatar Actually Is

An avatar is much more than a static sprite or 3D mesh. It is the comprehensive **presentation and interaction layer** for an AI participant: encompassing visual meshes, facial/body motions, physical events, carrier capability negotiation, and backend rendering pipelines across graphical backends (Live2D, VRM, etc.).

Presentation must faithfully mirror underlying agent state rather than synthesizing parallel truths:
- If an avatar animation freezes due to a renderer glitch, that is an isolated presentation defect—the underlying agent is not offline;
- If a carrier displays an optimized fallback model on low-power hardware, that is a local rendering adaptation—the agent's personality and cognition remain unchanged.

## Division of Responsibilities

**Avatar owns:**
- Projecting abstract agent embodiment cues (motions, expressions, gaze targets) onto a concrete carrier surface;
- Negotiating whether a carrier can render a given visual model and determining the appropriate fallback form;
- Managing shell-specific rendering branches across desktop and platform environments.

**Avatar does not own:**
- Character persistent identity (governed by Realm) or LocalAgent execution identity (managed by Runtime lifecycles);
- An Agent's long-term memory (maintained by Cognition; Runtime tracks active session state);
- Social graphs and relationship networks within virtual worlds (owned by Realm);
- Dialogue inference generation and cognitive planning (orchestrated by Runtime).

This decoupling is essential: if the presentation layer were to arbitrarily determine "who the agent is" or "what it remembers," it would conflict with platform sources of truth and compromise cross-platform continuity.

## Typical Scenario: A Carrier Cannot Render Full Embodiment Capabilities

An agent's embodiment definition contains complex skeletal animations or particle physics that the target device cannot sustain:

1. **Capability negotiation**: The carrier evaluates asset requirements against visual acceptance contracts.
2. **No silent half-renders**: The carrier avoids displaying broken meshes or corrupt blendshapes. It triggers governed fallback: stepping down to an admitted alternative presentation (such as a lightweight 2D sprite) or returning a typed incompatibility error.
3. **Preserving underlying authority**: Character identity in Realm and cognitive state in Runtime remain untouched by carrier adaptations.

Presentation adjustments stay encapsulated within Avatar; the Agent remains the Agent.

## Typical Scenario: Why Avatar is Decoupled from Runtime

Why is presentation an autonomous architectural domain rather than an internal Runtime module? There are three primary reasons:

- **Carrier diversity**: The same embodiment must project across diverse host environments (floating desktop windows, web viewports, lightweight overlays);
- **Independent visual acceptance**: Graphics rendering involves distinct metrics (framerate budgets, GPU shaders, memory thresholds, texture formats);
- **Isolated debugging and replay**: Rendering bugs can be inspected, profiled, and replayed as pure graphics pipeline issues without dragging in complex dialogue session states.

Separating presentation from Runtime keeps each domain's contracts focused, testable, and robust.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
