# Inter-App Collaboration and Integration Messaging

In the Nimi ecosystem, applications collaborate through well-defined, permission-governed operations rather than through untyped global message buses. This design ensures that apps remain modular and isolated while safely reusing services provided by other apps.

## Contextual Integration Interfaces

| Task | Recommended SDK Interface | Access & Lifecycle Semantics |
| --- | --- | --- |
| **Invoke Services from Other Apps** | `client.integration` | Validated against typed schemas; requires explicit user permission |
| **Engage in LocalAgent Dialogue** | `client.conversation` | Uses authorized session-scoped `agentHandle` |
| **Execute Dedicated Agent Tasks** | `client.agentWork` | Employs dedicated project scopes and execution pipelines |
| **Publish or Inspect Activity Events** | `client.activity` | Follows author ownership, visibility policies, and retention rules |

## Practical Scenario: Querying Free Time Slots from a Calendar App

If a calendar app (such as NimiDay) exposes a structured integration endpoint to query free/busy slots:

1. **Discovery & Schema Lookup**: The calling app discovers the capability and its input schema via `client.integration`.
2. **User Authorization**: If the calling app lacks calendar access, Runtime returns `INTEGRATION_PERMISSION_REQUIRED`, guiding the user to grant standing permission in Home's Integrations workspace before retrying.
3. **Structured Invocation**: Once granted, the calling app dispatches typed parameters. The calendar app processes the request within its own protected execution channel and returns formatted time intervals.

## Protected Channels and Security Invariants

To safeguard the operating environment:
- **Service Isolation**: Runtime enforces boundaries around internal agent transport channels; client apps can only invoke declared, registered public integration surfaces.
- **Identity Integrity**: Applications cannot impersonate another app ID; caller provenance is strictly attested by the desktop host supervisor.

## Source Basis

- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/integration.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/integration.authority.yaml)
- [`sdks/typescript/core/app/local-app-runtime-platform.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform.ts)
