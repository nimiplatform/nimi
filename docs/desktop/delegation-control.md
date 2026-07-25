# Delegation Control

## Status: Admitted Contract; Desktop-Owned Surface

The Desktop agent delegation control surface contract
(`canonical/desktop/agent-projection.authority.yaml`) is
admitted at the kernel level. The user-facing approval +
quarantine UI is admitted as direction; public behavior belongs to Desktop,
not to app-owned SDK code.

## What Delegation Control Is

The Desktop Delegation Control surface is the **user-facing
control plane** for delegated capability — where a user sees an
approval prompt for an external AI's suggestion, where the user
reviews quarantined evidence, where the user approves or denies a
delegated action.

The runtime side (gateway + output firewall + verdicts) lives in
[Runtime → Delegated Capability](/runtime/delegated-capability).
This page covers the Desktop control surface that surfaces those
verdicts to the user.

## Boundary

| Owns | Does NOT own |
| --- | --- |
| Approval prompt rendering + decision capture | Firewall verdict (Runtime) |
| Quarantine evidence display | Quarantine semantics (Runtime) |
| User-facing reason copy | Reason code semantics (Runtime) |
| Per-user policy preferences for approval defaults | Trust tier admission (Runtime) |

The control surface is rendering + decision capture. Verdicts and
quarantine logic are runtime authority.

## Reader Scenario: Approval Prompt

External AI proposes a tool call; firewall verdict is
`APPROVAL_REQUIRED`.

1. **Runtime emits approval-required event.** Carries typed
   delegation request, firewall verdict, sensitivity, suggested
   action.
2. **Desktop control surface renders.** Approval card displays
   what the external AI suggested, why approval is needed, and the
   user's approve / deny options.
3. **User decides.** Approve or deny. Reason recorded.
4. **Runtime acts on user decision.** Approval recorded against the
   delegation session; if approved, runtime acts under its own
   audit lineage.

## Reader Scenario: Quarantine Review

Provider drift or sensitivity classification quarantines an output.

1. **Runtime emits quarantine event.** Carries typed evidence.
2. **Desktop surface lists quarantined items.** User can review.
3. **User releases or discards.** Decision recorded; runtime
   honors.
4. **No silent release.** Quarantined items do not flow to consumer
   until user decision.

## What Delegation Control Does Not Do

- It does not invent firewall verdicts.
- It does not silently change quarantine semantics.
- It does not allow approval-bypass shortcuts.
- It does not let user-preference policy override runtime-admitted
  approval requirements (preferences live within the admitted
  policy envelope).

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/kernel/delegated-approval-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-approval-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md)
