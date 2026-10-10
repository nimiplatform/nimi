# Credential Custody

Runtime resolves cloud credentials from the exact Connector committed in the owner's AIConfig. Apps may save safe Connector and target references through their authorized configuration API, but never receive or inject the credential.

## Request Path

1. The protected session identifies the account, App, and admitted operation.
2. Runtime validates the committed Cloud Connector and implementation target, request, access, and policy.
3. Runtime captures the effective inputs at submission and privately supplies admitted credentials to the Driver.
4. Results and diagnostics preserve typed outcomes while excluding secrets and private custody material.

No model search or credential-source fallback occurs. An ordinary AI request carries content and supported parameters, not a Connector selector, inline key, provider endpoint, or account override.

## Configure or Repair a Connection

Use Nimi Home's protected Cloud Services flow to provision or update the connection. Select its safe reference and exact target in the App's AI settings and save against the current revision. The App can inspect safe configuration options; it cannot inspect credential storage.

Portable Runtime config, `nimi config`, and standalone SDK clients are not provider-credential administration paths. A missing, disabled, wrong-owner, or invalid original Connector produces the owning operation's typed failure or observation issue. It does not authorize substituting another connection.

For an existing Job, retain its identity and captured target. Changing AIConfig affects future submissions and does not rebuild that Job. Current account, App access, policy, and original-Connector admission are checked separately from captured input.

## Source Basis

- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
