# AI Profile Config

## Status: Admitted, in build-out

The Desktop AI profile config contract
(`desktop/kernel/ai-profile-config-contract.md`) is admitted. The
user-facing per-agent configuration UI is in active build-out.

## What This Surface Is

The Desktop AI Profile Config surface is the **user-facing flow** for
configuring an AI profile per agent — picking model routing, adjusting
provider preferences, switching between admitted profiles, applying
profiles into AI scopes.

It does not let the user edit profile **execution semantics**. Execution
semantics belong to the runtime AI profile execution contract.

## Boundary

| Owns | Does NOT own |
| --- | --- |
| User UI flow for profile selection + apply | `AIProfile` portable schema (this contract pins it) |
| Per-agent / per-mod profile binding visibility | `AIScopeRef` identity (Platform) |
| Apply triggers + UI feedback | `LocalProfileDescriptor` execution (Runtime) |
| Profile preference UX | Probe semantics (Runtime/SDK split) |

The user picks; Desktop applies through the SDK; Runtime executes.
The user does not edit how runtime executes.

## Reader Scenario: User Picks A Profile For A Mod Workspace

User wants their notes mod to use a different AI profile.

1. **User opens profile config UI.** Sees admitted profiles.
2. **User selects profile.** Desktop calls SDK `aiConfig.applyProfile(...)`
   with the mod workspace's `AIScopeRef`.
3. **Profile applied.** Copy-on-write into the workspace scope's
   `AIConfig`.
4. **Subsequent execution under the new profile.** Mod's next AI call
   routes via the new profile.

## What This Does Not Do

- It does not let the user edit profile execution semantics.
- It does not let the user invent new scope kinds.
- It does not let the user materialize an `AIConfig` outside admitted
  profile apply flow.
- It does not let per-agent UI override `AIScopeRef` identity rules.

## Source Basis

- [`.nimi/spec/desktop/kernel/ai-profile-config-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/ai-profile-config-contract.md)
- [`.nimi/spec/platform/kernel/ai-scope-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/ai-scope-contract.md)
- [`.nimi/spec/runtime/kernel/ai-profile-execution-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/ai-profile-execution-contract.md)
