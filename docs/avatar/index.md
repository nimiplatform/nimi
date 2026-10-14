# Avatar

Nimi Avatar handles the visual presentation and embodied interaction of AI agents in its standalone desktop window. Its core architectural rule is simple: **presentation adapts to the host surface, while the Agent remains a single, continuous entity**—never splitting into a separate identity when the renderer or window changes.

## What an Avatar Is

An avatar is more than a static sprite or 3D mesh. It is the **presentation and local interaction layer** for an AI participant, covering visual models, facial and body motions, pointer hit handling, carrier capability checks, and rendering pipelines across supported graphics backends (`live2d` and `vrm`).

Presentation reflects underlying Agent state rather than inventing parallel state:
- If an animation freezes due to a local rendering glitch, that is an isolated presentation fault—that alone does not establish whether the Agent is online.
- When Avatar adjusts local rendering or reports an unavailable model, the Agent's identity, memory, and cognition remain unchanged.

## Division of Responsibilities

**Avatar owns:**
- Translating admitted Agent embodiment updates (activities, emotions, gaze targets, and voice artifacts) onto a carrier surface;
- Evaluating whether a carrier can host a given visual package and reporting supported presentation or a clear incompatibility;
- Managing shell-specific rendering branches (`live2d` and `vrm`).

**Avatar does not own:**
- Persistent Character identity (owned by Realm) or LocalAgent execution lifecycle (owned by Runtime);
- Long-term Agent memory (managed by Cognition and accessed through Runtime, while Runtime tracks active session state);
- Social graphs and world relationships (owned by Realm);
- Dialogue inference and cognitive planning (orchestrated by Runtime).

Keeping presentation decoupled from identity and cognition ensures that visual surfaces never conflict with platform sources of truth.

## Typical Scenario: When a Carrier Cannot Render Full Embodiment

Suppose an embodiment package requires skeletal animations or resources beyond what the target carrier supports:

1. **Capability evaluation**: The carrier checks package requirements against its visual acceptance contract.
2. **No silent half-renders**: Instead of displaying broken meshes or corrupt blendshapes, the carrier follows its contract—returning a typed incompatibility error when the required model or backend is unsupported.
3. **Unchanged Agent state**: Character identity in Realm and session/cognitive state in Runtime remain intact regardless of local presentation adjustments.

## Why Avatar Is Decoupled from Runtime

Keeping Avatar separate from Runtime serves three practical goals:

- **Surface diversity**: The same Agent embodiment can project onto desktop character surfaces and local overlays without changing Runtime semantics.
- **Independent visual contracts**: Graphics pipelines have their own acceptance criteria—frame budgets, shaders, memory limits, and model schemas.
- **Isolated debugging**: Rendering issues can be inspected and reproduced as graphics pipeline problems without entangling dialogue inference or session state.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
