# Platform Kit

`@nimiplatform/kit` delivers reusable UI components and host integration building blocks for Nimi Apps. It allows applications to share visual design systems, accessible interaction patterns, Shell adapters, and core UI primitives, while business logic and domain authority remain strictly with each App and its underlying platform services.

## Core Module Surfaces

| Subpath | Scope & Responsibility |
| --- | --- |
| `ui` | Shared design tokens, theme schemes, and core UI primitives |
| `auth` | Reusable user authentication presentation and adapter workflows |
| `core` | Host-neutral utilities and capability helper libraries |
| `telemetry` | Renderer telemetry and React error boundary components |
| `shell/tauri` | Lightweight Rust host glue for Tauri environments |

Kit evolves on concrete demand: shared surfaces are introduced only when multiple apps or host environments establish recurring needs with unambiguous component boundaries. Kit avoids speculative abstractions and preemptive catalog expansion.

## Host Environments: Electron and Tauri

Nimi App development defaults to the Desktop-supervised Electron host, which bundles the full standard shell.

Tauri serves as an explicitly configured lightweight alternative, where the shared Tauri crate implements a focused subset of capabilities:

- **Supported on Tauri**: Session status queries, App AIConfig, single-shot text generation (`generateCandidate`), Artifact uploads, local storage (JSON documents and static assets), Realm World and PersonaCharacter operations, shared Agent AIConfig, Agent management (autonomy, appearance, memory controls, embodiment), and App Activity tracking.
- **Not supported on Tauri**: Streamed text turns, Scenario orchestration and Job scheduling, Artifact downloads, voice assets, Realm realtime chat and channels, Agent collaboration recommendations, third-party Integrations, realtime audio/video sessions, native media player handles, Avatar host handoff, and Resource Pack imports.
- **Invocation behavior**: Calling an unsupported capability on Tauri fails immediately before shell dispatch with `capability-unavailable` (reason `tauri-standard-shell-operation-unsupported`). Custom Tauri commands registered independently by the App remain unaffected.

## Ownership Boundaries

Kit owns reusable presentation patterns and host-neutral interaction mechanics. It deliberately excludes:

- App-specific business workflows, layouts, or product decisions;
- Runtime layer state (LocalAgent, Conversation, Memory, Knowledge, or readiness states);
- Realm virtual worlds, character personas, accounts, or canonical social graph records;
- Avatar execution pipelines or skeletal rendering engine internals;
- AI provider routing, backend execution, or permission authorization rules.

Apps consume Kit through public subpaths and compose primitives locally. Apps must not import private internal paths from Kit, nor should they re-implement primitives already maintained by Kit.

## Typical Scenario: Reusing a Shared Confirmation Dialog

An application requires an accessible, platform-consistent confirmation modal:

1. **Import cleanly**: The App imports `Dialog` and relevant semantic tokens from `@nimiplatform/kit/ui`.
2. **Supply business content**: The App defines dialog copy, form inputs, and action handlers.
3. **Delegate interaction mechanics**: Kit handles focus trapping, keyboard navigation, and accessibility semantics automatically.
4. **Maintain separation of concerns**: Product workflows stay inside the App; Kit provides shared visual and accessibility primitives; each App still needs to verify its own composition and interaction.

For visual styling standards, see [Design Pattern](/platform/kit/design-pattern). To get started integrating Kit in your application, see [Use Kit in an App](/platform/kit/use-kit-in-app).

## Source Basis

- [`.nimi/spec/platform/ui-design-system.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ui-design-system.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
