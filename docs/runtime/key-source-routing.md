# Credential Custody and Key Source Routing

In Nimi, all third-party cloud model provider API keys and credentials are maintained securely by Runtime in protected local storage. Applications refer to cloud services using safe symbolic references (`connectorRef`), eliminating the risk of hardcoding or transmitting plaintext secrets in client-side code.

## End-to-End Credential Routing Pipeline

1. **Session Authentication**: When an app dispatches an inference request, Runtime verifies caller identity and authorized capability scopes via the host session.
2. **Connector Resolution**: Using the `connectorRef` declared in the active AIConfig, Runtime resolves the associated credentials from protected local storage.
3. **Driver Encapsulation**: Runtime's provider driver encapsulates prompts and credentials into the provider's native wire format and handles TLS transmission.
4. **Scrubbing and Response Delivery**: Upon receiving the response, provider-proprietary headers, authentication tokens, and internal routing metadata are stripped, returning clean content streams to the client application.

This brokered routing pattern keeps user credentials secure while allowing applications to switch between upstream model providers without code changes.

## Configuration and Troubleshooting

- **Configuration Workflow**: Users input and update API keys under "Cloud Services" in Nimi Home. In application AI settings, developers or users simply select the desired connector from a dropdown.
- **Credential Rotation**: If a key expires or requires replacement, updating the connector under Cloud Services immediately updates all dependent applications without requiring reconfigurations.

## Source Basis

- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
