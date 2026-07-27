# Platform Kit

`@nimiplatform/kit` provides reusable UI and host-integration building
blocks for Nimi Apps. It lets real consumers share a visual language,
accessibility behavior, shell adapters, and common interaction
primitives without moving product truth into the package.

## Current Role

| Kit surface | Responsibility |
| --- | --- |
| `ui` | Shared tokens, themes, and UI primitives |
| `auth` | Reusable authentication presentation and adapters |
| `core` | Host-neutral utility and capability helpers |
| `telemetry` | Renderer telemetry and error-boundary helpers |
| `shell/tauri` | Bounded native-host glue |

Kit is demand driven. A reusable surface is added when a real App or
host needs the same behavior and the product owner is already clear.
Kit does not prebuild a public feature catalog merely to make the
ecosystem look complete.

## Owner Boundary

Kit may own reusable presentation and host-neutral interaction
behavior. It does not own:

- App-specific product flows or layout;
- Runtime LocalAgent, Conversation, Memory, Knowledge, or readiness;
- Realm world, Character, account, or social truth;
- Avatar execution or rendering authority;
- provider routing, backend execution, or authorization truth.

Apps import Kit through public subpaths and compose those primitives
locally. They do not import private Kit paths or duplicate a shared
primitive under App-local ownership.

## Reader Scenario: Reusing A Shared Dialog

An App needs the same accessible confirmation dialog already used by a
first-party surface.

1. The App imports the public Kit dialog and shared semantic tokens.
2. The App provides its own product copy and action handler.
3. Kit supplies focus management, keyboard behavior, and shared visual
   semantics.
4. The App remains the owner of the product decision; Kit remains the
   owner of the reusable interaction primitive.

For visual-system details, see
[Design Pattern](/platform/kit/design-pattern). For App integration,
see [Use Kit In An App](/platform/kit/use-kit-in-app).

## Source Basis

- [`.nimi/spec/platform/ui-design-system.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ui-design-system.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
