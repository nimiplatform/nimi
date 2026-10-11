# Platform Kit

`@nimiplatform/kit` provides reusable UI components and host integration building blocks for Nimi Apps. Developers can readily share visual design language, accessibility behaviors, Shell adapters, and common UI interaction primitives, while business logic and domain authority remain firmly owned by the Apps and underlying platform services.

## Core Module Surfaces

| Subpath | Scope & Responsibility |
| --- | --- |
| `ui` | Shared design tokens, theme schemes, and core UI primitives |
| `auth` | Reusable user authentication presentation and adapter workflows |
| `core` | Host-neutral utilities and capability helper libraries |
| `telemetry` | Renderer telemetry and React error boundary components |
| `shell/tauri` | Lightweight Rust host glue for Tauri environments |

Kit follows a demand-driven evolution principle: reusable surfaces are added only when multiple apps or host environments have clear reuse requirements and unambiguous component boundaries. Kit avoids speculative design and does not assemble redundant catalogs simply for the appearance of ecosystem completeness.

## Host Environments: Electron and Tauri

Nimi App development defaults to the Desktop-supervised Electron host, which packages the complete standard shell.

Tauri is an explicitly configured lightweight alternative, where the shared Tauri crate implements a targeted subset of capabilities:

- **Supported on Tauri**: Session status queries, App AIConfig, single-shot text generation (`generateCandidate`), Artifact uploads, local storage (JSON documents and static assets), Realm World and PersonaCharacter operations, shared Agent AIConfig, Agent management (autonomy, appearance, memory controls, embodiment), and App Activity tracking.
- **Not supported on Tauri**: Streamed text turns, Scenario orchestration and Job scheduling, Artifact downloads, voice assets, Realm realtime chat and channels, Agent collaboration recommendations, third-party Integrations, realtime audio/video sessions, native media player handles, Avatar host handoff, and Resource Pack imports.
- **Invocation behavior**: Attempting to invoke unsupported capabilities on a Tauri host fails immediately before shell dispatch with `capability-unavailable` (reason `tauri-standard-shell-operation-unsupported`). Custom Tauri commands registered independently by the App are unaffected.

## Ownership Boundaries

Kit owns reusable presentation patterns and host-neutral interaction mechanics. It deliberately avoids owning:

- App-specific business workflows, layouts, or product logic;
- Runtime layer concerns (LocalAgent, Conversation, Memory, Knowledge, or readiness states);
- Realm virtual worlds, character personas, accounts, or social graph canonical state;
- Avatar execution pipelines or skeletal rendering core authority;
- AI provider routing, backend execution, or permission authorization rules.

Apps consume Kit via public subpaths and compose primitives locally. Apps should not import internal private paths from Kit, nor should they duplicate primitives already maintained by Kit.

## Typical Scenario: Reusing a Shared Confirmation Dialog

An App requires an accessible, platform-consistent confirmation modal:

1. **Import cleanly**: The App imports `Dialog` and semantic tokens from `@nimiplatform/kit/ui`.
2. **Define business content**: The App supplies its own dialog copy, form elements, and action handlers.
3. **Delegate interaction mechanics**: Kit manages keyboard focus traps, navigation, and accessibility semantics automatically.
4. **Clear division of labor**: Product decisions remain in the App; accessibility and visual consistency are guaranteed by Kit.

For visual design guidelines, see [Design Pattern](/platform/kit/design-pattern). To get started integrating Kit in your application, see [Use Kit in an App](/platform/kit/use-kit-in-app).

## Source Basis

- [`.nimi/spec/platform/ui-design-system.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ui-design-system.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
