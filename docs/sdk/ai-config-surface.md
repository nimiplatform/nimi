# AI Config Surface

## Status: Admitted, in build-out

The SDK AI config surface contract
(`sdk/kernel/ai-config-surface-contract.md`) is admitted. It pins
how app developers configure AI profiles via SDK; the developer-facing
surface is in active build-out.

## What This Surface Does

The AI Config Surface is the SDK boundary where an app developer
binds AI profile configuration to a scope. It pairs with:

- [Platform → AI Scope Identity](/platform/ai-scope-identity) — the
  `AIScopeRef` identity contract
- [Runtime → AI Profile Execution](/runtime/ai-profile-execution) —
  the runtime-side execution + snapshot contract

The SDK side is the **typed config / profile / snapshot API** apps
call to apply profiles, probe, and inspect snapshots.

## Method Families

| Family | Purpose |
| --- | --- |
| Profile apply | Apply a profile to an `AIScopeRef` (copy-on-write into the scope's `AIConfig`) |
| Profile resolve | Resolve the effective `AIConfig` for a scope |
| Probe (static / availability / feasibility) | Validate before execution |
| Snapshot read | Read execution evidence per `K-AIEXEC-003` |

## Boundary

| Owns | Does NOT own |
| --- | --- |
| Typed config / profile / snapshot API | `AIProfile` portable schema definition |
| Scope parameter shape | Scope-owner AIConfig intent |
| Probe surface for callers | `LocalProfileDescriptor` execution (Runtime) |

The SDK is the typed access surface. The scope owner owns AIConfig
intent; Runtime owns local facts, readiness, and execution evidence.

## Reader Scenario: App Applies An AI Profile

App wants to apply a profile to an app-owned workspace.

1. **App calls SDK.** `aiConfig.applyProfile({ scope: { kind: 'app',
   ownerId: 'nimi.shijing', surfaceId: 'workspace' }, profile })`.
2. **SDK validates.** Scope identity per `AIScopeRef` rules.
3. **Scope owner performs profile apply.** Copy-on-write into the
   workspace scope's `AIConfig`.
4. **Subsequent execution under the new profile.**

## What This Does Not Do

- It does not let apps invent scope kinds.
- It does not let apps materialize `AIConfig` directly bypassing
  profile apply.
- It does not let apps consume AIScopeRef from another scope's
  config as runtime fallback.

## Source Basis

- [`.nimi/spec/sdk/kernel/ai-config-surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/ai-config-surface-contract.md)
- [`.nimi/spec/platform/kernel/ai-scope-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/ai-scope-contract.md)
- [`.nimi/spec/runtime/kernel/ai-profile-execution-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/ai-profile-execution-contract.md)
