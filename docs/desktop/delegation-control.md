# Delegation Control and Security Auditing

> **Status**: Specification design / Reserved contract. External agent action execution remains disabled while the action registry is unpopulated (`EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY`). In current desktop builds, users can inspect gateway and token status under "Advanced & Diagnostics → Permissions & Access"; interactive approval cards and quarantine review workflows described below represent the target security contract.

Delegation Control defines the security control plane inside Nimi Desktop. When external AI agent action execution is enabled, this control plane will prompt for explicit user approval before sensitive actions proceed, ensuring operations never execute without informed consent.

For the architecture of the underlying gateway and firewall, see [Runtime → Delegated Capability](/runtime/delegated-capability). This page covers the desktop user interface and auditing contract design.

## Key Security Principles (Contract Design)

1. **Explicit User Approval**: Under the delegation contract, any cross-boundary or sensitive action proposed by an AI agent requires manual confirmation before execution. Unapproved actions fail closed by default.
2. **Quarantine Review**: When generated outputs trigger safety policies or sensitive data filters, content is intercepted into a secure quarantine. Users can inspect the exact evidence and decide whether to release or discard it.
3. **Transparent Reasoning**: Every approval prompt details the caller's identity, the proposed operation, the parameters involved, and the specific security policy that triggered the check.

## Division of Responsibilities

| Desktop Interface | Underlying Runtime Security Engine |
| --- | --- |
| Renders approval cards and capture user decisions | Evaluates firewall rules and content classifications |
| Displays quarantine evidence and inspectable context | Enforces hard boundaries and intercepts unauthorized calls |
| Saves user preferences for non-critical notification defaults | Logs bounded, sanitized local audit events for every security decision |

## Specification Workflows (Contract Design)

The following scenarios illustrate how the delegation contract governs external agent operations once the action registry and external gateway execution are active:

### 1. Tool Call Approval
1. **Approval Request**: An external AI agent proposes writing to a local configuration file. The security firewall marks this action as `APPROVAL_REQUIRED`.
2. **Interactive Prompt**: Desktop displays an approval card showing the target path, content diff, and rationale.
3. **User Action**:
   - If approved, Runtime records the decision in the audit trail and proceeds with execution.
   - If declined, the operation halts immediately and returns an access-denied state.

### 2. Quarantined Content Handling
When an agent's proposed action or output is classified as `QUARANTINED` by safety policies, it is intercepted and prevented from flowing into downstream applications. In the delegation workflow, the security decision and rationale are surfaced to the user for explicit review rather than silently bypassing guardrails.

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
