# Authentication Token Validation and Authorization

At Nimi's network boundaries, public APIs and remote interactions authenticate via industry-standard JWT validation. Local protected applications communicate via verified desktop host sessions with Runtime; see [Account and Protected Sessions](/runtime/account-and-session).

## Bearer Token Transport Conventions

| Rule | Specification | Exception Handling |
| --- | --- | --- |
| **Transport Header** | gRPC metadata `authorization` or HTTP `Authorization` | Normalized automatically |
| **Token Format** | Strictly `Bearer <jwt>` | Missing prefix treated as invalid |
| **Anonymous Access** | Permitted on designated public endpoints when header is absent | Restricted to public endpoints |
| **Malformed Tokens** | Returns `UNAUTHENTICATED` with `AUTH_TOKEN_INVALID` | Malformed tokens never fall back to anonymous status |

## Required Standard Claims

A valid Realm identity JWT must contain the following standard claims:

- `iss` (Issuer): Authorized identity provider domain (must match `auth.jwt.issuer`);
- `aud` (Audience): Target service recipient (token audience must equal configured `auth.jwt.audience`, or audience array must contain it);
- `sub` (Subject): Cryptographic identifier of the authenticating principal;
- `exp` (Expiration Time): Unix epoch timestamp of token expiry (enforced with a fixed `±60s` skew window);
- `iat` (Issued At): Token issuance timestamp;
- `nbf` (Not Before): Optional timestamp; evaluated for temporal validity whenever present;
- `sid` (Session ID): Required for session revocation checks after signature validation.

## Cryptographic Algorithms and Key Discovery (JWKS)

- **Strict Algorithm Constraint**: Restricted strictly to `RS256`. Undeclared algorithms, symmetric signatures, `alg=none`, or headers without a `kid` are rejected unconditionally.
- **JWKS Cache & Dynamic Fetch**: Runtime caches public signing keys fetched from `auth.jwt.jwksUrl`. Unrecognized `kid` identifiers trigger a single refresh attempt.
- **Clock Skew Tolerance**: Evaluates `exp` and `nbf` within a fixed `±60s` skew window without soft tolerance outside that boundary.

## Session Revocation and Failure Taxonomy

Bearer authentication configuration requires `auth.jwt.revocationUrl`, `auth.jwt.issuer`, `auth.jwt.audience`, and `auth.jwt.jwksUrl` to be configured atomically.

- **Revocation Check**: After signature and claim verification pass, Runtime posts JSON (`session_id`, `subject_user_id`, `issuer`, `audience`, `issued_at`, `expires_at`) to `auth.jwt.revocationUrl`. The response must be HTTP 200 with `application/json` containing `active: boolean` and `revoked: boolean`. A response with `revoked: true` or `active: false` indicates the session is revoked.
- **Authentication Failure Taxonomy**:
  - Malformed tokens, invalid signatures, missing required claims, undeclared algorithms, or clock skew violations return `UNAUTHENTICATED` with reason code `AUTH_TOKEN_INVALID`.
  - Revoked or expired sessions return `UNAUTHENTICATED` with reason code `SESSION_EXPIRED`.
  - Indeterminate revocation (network errors, non-2xx responses, malformed JSON payloads) returns `UNAVAILABLE` with reason code `AUTH_REVOCATION_UNAVAILABLE` (retryable); it never downgrades to active or anonymous.

## Distinct Phases: Authentication vs. Authorization

- **Authentication (AuthN)**: "Is the bearer identity verified, active, and unexpired?" Evaluates cryptographic signatures, claim constraints, validity windows, and session revocation.
- **Authorization (AuthZ)**: "Does this principal hold the required permission scope to modify this specific resource?" Evaluates granted capability scopes against resource ownership after successful authentication.

Separating these concerns guarantees that possessing a valid cryptographic identity alone does not permit cross-tenant data tampering.

## Source Basis

- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
