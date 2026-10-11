# Local Audit and Security Logging Architecture

Runtime maintains a structured local security audit ledger covering every AI model invocation, authorization decision, inter-app collaboration event, and external agent action. The audit ledger is persisted securely on the user's local device, upholding local-first privacy and user autonomy.

## Scope of Local Auditing

| Event Family | Example Captured Data | Operational Value |
| --- | --- | --- |
| **AI Inference Lifecycle** | Task submission, execution milestones, terminal success or failure | Diagnostic tracking of latency and runtime health |
| **Model Routing & Selection** | Local engine assignments, cloud connector routing, parameter snapshots | Reproducibility of inference configurations |
| **Authorization Decisions** | Token validation results, scope evaluations, capability gating | Security verification and boundary enforcement |
| **Delegated Tool Calls** | Proposed action payloads, output firewall verdicts, user approvals | End-to-end provenance for agent behaviors |
| **Memory Operations** | Memory consolidation entries, semantic recall logs, reset events | Auditing cognitive state and memory evolution |

Each audit entry records structured lineage (including Trace ID and Principal ID) and precise timestamps, persisting durably across Runtime restarts within local retention bounds.

## Local-First Design Principles

1. **User Data Ownership**: Audit data resides by default in protected local SQLite storage managed by Runtime and is never uploaded without explicit consent.
2. **Offline Resilience**: Operates deterministically without network connectivity, capturing complete operational telemetry in air-gapped setups.
3. **Optional Cloud Aggregation**: In enterprise or synchronized environments, users can enable telemetry export to stream sanitized aggregate metrics to Realm.

## Diagnostic Scenario: Reconstructing a Failed Inference Request

When an application encounters an unexpected inference failure, developers can reconstruct the root cause using the Trace ID:

1. **Locate Trace ID**: Copy the Trace ID provided in the UI error bubble or client logs.
2. **Inspect Job Lifecycle**: Trace the lifecycle progression (`SUBMITTED → RUNNING → FAILED`).
3. **Pinpoint Root Cause**: The audit record captures the provider lineage, routed engine/endpoint information, and the exact error code returned (such as context window limits or timeout), eliminating guesswork.

## Source Basis

- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
