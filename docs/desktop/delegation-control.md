# Delegation Control

## Status: Admitted Contract; Desktop-Owned Surface

Delegation Control is a Desktop surface, defined at the kernel level
(`canonical/desktop/agent-projection.authority.yaml`). The approval
and quarantine UI you use belongs to Desktop itself, not to app-owned
SDK code.

## What Delegation Control Is

Delegation Control is where **you stay in charge** of delegated
capability. When an external AI suggests an action, the approval
prompt appears here. When an output is quarantined, you review the
evidence here. You approve or deny — nothing proceeds on your behalf
without you.

The runtime side (gateway + output firewall + verdicts) lives in
[Runtime → Delegated Capability](/runtime/delegated-capability).
This page covers the Desktop control surface that brings those
verdicts to you.

## Boundary

| Owns | Does NOT own |
| --- | --- |
| Approval prompt rendering + decision capture | Firewall verdict (Runtime) |
| Quarantine evidence display | Quarantine semantics (Runtime) |
| User-facing reason copy | Reason code semantics (Runtime) |
| Per-user policy preferences for approval defaults | Trust tier admission (Runtime) |

This surface renders the situation and captures your decision. The
verdicts and quarantine logic themselves come from Runtime.

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

- It never makes up a firewall verdict.
- It never quietly changes quarantine semantics.
- It offers no approval-bypass shortcuts.
- Your preference policy can streamline prompts, but it can't override
  an approval Runtime requires.

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
