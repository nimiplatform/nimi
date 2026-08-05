# Credential Source Resolution

> Status: Runtime-managed credential custody.

Runtime resolves provider credentials only after admitting the caller and the
requested capability. An ordinary App request does not select a credential
source and does not carry a connector id, provider id, endpoint, API key, or
credential metadata.

## Custody Boundary

| Concern | Owner |
| --- | --- |
| Provider credential or credential reference | Runtime configuration |
| Connector identity and lifecycle | Runtime |
| Credential decryption and Driver injection | Runtime |
| Caller and capability admission | Runtime protected session |
| App request content | Caller identity, scenario content, supported parameters |

Desktop and CLI can provision credentials through admitted machine
administration commands. That administration flow is separate from capability
execution. It does not return secret material to the renderer and does not give
an App a connector selector.

## Runtime Resolution

For an admitted cloud capability, Runtime performs a fixed internal sequence:

1. Validate the protected caller identity and App authorization.
2. Validate the canonical capability request.
3. Read Runtime-owned machine configuration and admitted provider catalogs.
4. Select an eligible implementation and its credential record.
5. Validate endpoint and credential policy inside Runtime.
6. Give the credential to the selected Driver through an internal execution
   context.
7. Redact secret material from diagnostics and audit output.

Downstream Drivers receive only the credential selected by Runtime. Apps and
SDK adapters cannot read the credential store or override the selected record.

## Administration Inputs

A credential administration command may accept secret material or a reference
to a host-owned secret store. It must run through the protected administration
surface, validate exact ownership, and return only non-secret status. These
inputs never become fields on text, embedding, image, video, speech, or Agent
execution requests.

Generated transport types can still contain retired connector or inline-key
slots. Handwritten SDK and App callers omit them. Supplying those fields through
an untyped object is rejected rather than treated as a compatibility path.

## Reader Scenario: Configure Cloud Execution

1. A machine administrator opens Runtime configuration in Desktop or CLI.
2. The administrator provisions an admitted provider credential.
3. Runtime validates and stores the credential under its own custody.
4. An App owner records Cloud capability intent in `AIConfig` without naming a
   provider or connector.
5. The App invokes the capability with identity, scenario content, and supported
   parameters.
6. Runtime selects the implementation and credential internally, then returns a
   typed result or failure.

The App never receives the raw key or the connector identity used for execution.

## Reader Scenario: Missing Credential

1. An App submits an admitted Cloud capability request without execution
   controls.
2. Runtime finds no valid credential record for any admitted implementation.
3. Runtime returns a typed configuration or authorization failure.
4. The App preserves that failure. It does not inject an inline key, select a
   connector, or fabricate a local fallback.
5. A machine administrator repairs Runtime configuration through the separate
   administration surface.

## Public Boundary

- Ordinary App and Agent requests contain no credential-source metadata.
- Connector ids, provider ids, endpoints, API keys, and native provider handles
  remain Runtime configuration.
- `AIConfig` Cloud intent does not identify a credential or implementation.
- Runtime alone resolves credentials and injects them into Drivers.
- Secret or credential-adjacent data must not appear in normalized results,
  diagnostics, logs, or App storage.

## Source Basis

- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
