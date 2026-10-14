# Delegation Control and Security Auditing

> **Status**: Specification design / Reserved contract. External agent action execution remains disabled while the action registry is unpopulated (`EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY`). In current desktop builds, you can inspect gateway and token status under **Advanced & Diagnostics → Permissions & Access**. The interactive approval cards and quarantine review workflows below describe the target security contract.

Delegation Control defines the security control plane in Nimi Desktop. Once external AI agent action execution is enabled, this control plane will prompt you for explicit approval before any sensitive action runs, ensuring operations never proceed without informed consent.

For the underlying gateway and firewall architecture, see [Runtime → Delegated Capability](/runtime/delegated-capability). This page focuses on the desktop interface and auditing contract.

## Core Security Principles

1. **Explicit User Approval**: Under the delegation contract, any cross-boundary or sensitive action proposed by an AI agent requires manual confirmation before execution. Unapproved actions fail closed by default.
2. **Quarantine Review**: When generated output triggers safety policies or sensitive-data filters, the system intercepts it in a secure quarantine. You can inspect the exact evidence and choose whether to release or discard it.
3. **Transparent Reasoning**: Every approval prompt shows the caller's identity, the proposed operation and parameters, and the specific security policy that triggered the check.

## Division of Responsibilities

| Desktop Interface | Underlying Runtime Security Engine |
| --- | --- |
| Renders approval cards and captures your decisions | Evaluates firewall rules and content classifications |
| Displays quarantine evidence and inspectable context | Enforces hard boundaries and blocks unauthorized calls |
| Saves your preferences for non-critical notification defaults | Logs bounded, sanitized local audit events for every security decision |

## Target Workflows

The following scenarios show how the delegation contract governs external agent operations once the action registry and external gateway execution are active:

### 1. Tool Call Approval
1. **Approval Request**: An external AI agent proposes writing to a local configuration file. The security firewall flags the action as `APPROVAL_REQUIRED`.
2. **Interactive Prompt**: Desktop displays an approval card showing the target path, content diff, and rationale.
3. **User Decision**:
   - **Approve**: Runtime records the decision in the local audit log and executes the action.
   - **Decline**: The operation halts immediately and returns an access-denied state.

### 2. Quarantined Content Handling
When safety policies classify a proposed action or output as `QUARANTINED`, Runtime intercepts it before it can reach any downstream application. Instead of failing silently or bypassing guardrails, Desktop surfaces the security decision and supporting rationale so you can review and resolve it explicitly.

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
