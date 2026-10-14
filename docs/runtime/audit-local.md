# Local Audit and Security Logs

Use Runtime’s audit records to trace a failed request, understand an access refusal, or inspect a lifecycle change. Records carry the owning operation’s result, correlation and time; an audit entry does not itself prove that a product journey succeeded.

## What the Records Contain

Runtime records security-relevant authentication, authorization, execution, lifecycle and resource facts. Diagnostic projections are bounded and redacted: credentials, session proofs, raw private content and provider secrets do not belong in them.

Records are retained locally under count and encoded-size limits. Oldest records are evicted when those bounds are reached, and repeated identical refusals can share a counted record. Audit storage is not a permanent, exhaustive history of everything an App has done.

## Investigate a Failed Request

1. Keep the returned reason code, action hint and Trace ID when present.
2. Use the available Runtime diagnostics to locate the matching operation and its actual outcome.
3. For a Job, inspect the original Job ID before deciding whether another submission is safe. A missing audit row does not prove that an external action never happened.

Authorized audit export produces bounded diagnostic output; it does not imply automatic cloud aggregation or a Realm telemetry upload service. Handle exported records according to the information they actually contain.

## Source Basis

- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
