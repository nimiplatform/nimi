# Auth Token Validation

Bearer JWT validation applies only to operations that admit that authentication path. It does not establish protected Local App origin. Formal Nimi Apps use the verified Host session and receive no Realm bearer; see [Account and Sessions](/runtime/account-and-session).

## Bearer Token Input Model

| Rule | Value |
| --- | --- |
| Header key | gRPC metadata `authorization` (HTTP `Authorization` normalizes here) |
| Token shape | `Bearer <jwt>` only |
| No header | Anonymous (not an error) |
| Header present but malformed | `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID` (no degrade-to-anonymous) |

A malformed token is **never** treated as anonymous. The runtime
fails the request with a typed reason; it does not silently drop
identity.

## Required Claims

Realm JWT minimum mandatory claims:

| Claim | Purpose |
| --- | --- |
| `iss` | Issuer |
| `aud` | Audience |
| `sub` | Subject |
| `exp` | Expiry |
| `iat` | Issued at |
| `nbf` (when present) | Must be honored in time-window validation |

## Algorithm + Header Constraints

| Rule | Value |
| --- | --- |
| Allowed algorithms | `RS256` only, using the generated Realm JWKS key contract |
| `alg=none` | Rejected |
| Missing `kid` | Rejected |

`alg=none` is a known JWT vulnerability vector. The runtime refuses
unconditionally.

## JWKS Cache + Refresh

| Rule | Value |
| --- | --- |
| Read posture | Cache-first; cache miss or `kid` miss triggers a single refresh |
| Refresh failure | Must NOT degrade to anonymous; returns `UNAUTHENTICATED` |
| Failure fallback | Short TTL window may keep using the most recent successful snapshot for already-hit `kid`s |
| `auth.jwt.jwksUrl` | The only admitted source for runtime verification public keys |
| `publicKeyPath` | NOT a valid verification source |
| Default scheme | HTTPS; HTTP only allowed when host is loopback (`localhost` / `127.0.0.0/8` / `::1`) for local dev |

## Clock Skew

| Rule | Value |
| --- | --- |
| Skew window | Fixed `±60s` |
| Beyond window | Token invalid; no soft tolerance |

A token within the skew window validates. Outside, it does not. The
runtime does not negotiate.

## Session Revocation Check

After signature validation passes, the runtime still checks session
revocation when the session domain is available.

| Rule | Value |
| --- | --- |
| Revoked / expired session | `UNAUTHENTICATED` + `SESSION_EXPIRED`; reauthenticate, not retryable |
| Revocation cannot be determined | `UNAVAILABLE` + `AUTH_REVOCATION_UNAVAILABLE`; retryable, no anonymous or active fallback |
| Introspection endpoint | `auth.jwt.revocationUrl` |
| Required claim for introspection | `sid` |
| Missing config (`issuer` / `audience` / `jwksUrl` / `revocationUrl`) | Bearer JWT path fails closed |

The introspection contract is fixed: `POST` to `revocationUrl` with
JSON body containing `session_id`, `subject_user_id`, `issuer`,
`audience`, `issued_at`, `expires_at`. Response body must contain
`active: boolean`, `revoked: boolean`, optional `expires_at`.
`revoked=true` or `active=false` both count as revoked. Network
errors / non-2xx / malformed response **must NOT** degrade to
anonymous; they return `UNAVAILABLE` with `AUTH_REVOCATION_UNAVAILABLE`.

## AuthN vs AuthZ

The two stages are distinct and run in fixed order:

| Stage | Question | Failure code |
| --- | --- | --- |
| AuthN | "Is this token and session valid?" | Invalid token: `AUTH_TOKEN_INVALID`; revoked/expired session: `SESSION_EXPIRED`; indeterminate revocation: `AUTH_REVOCATION_UNAVAILABLE`, with the statuses above |
| AuthZ | "Is this principal allowed to do this? Does it own what it claims to mutate?" | `PERMISSION_DENIED` + typed authz reason |

Confusing the two is a recurring bug pattern. A valid token does not
imply ownership. A missing token is not a permission failure.

## AuthZ Ownership Posture

AuthZ ownership rules govern which principal owns which kind of
resource. The principal types include:

| Principal type | Source |
| --- | --- |
| First-party Nimi user | `RuntimeAccountService` |
| Admitted first-party app | Current authenticated app session or protected local-app per-operation decision |
| Local first-party machine actor | Runtime-internal authority |
| ExternalPrincipal | `K-DELEG-*` delegated provider gateway |

Each principal type has admitted authz domains. Cross-domain access
fails closed; an ExternalPrincipal cannot mutate first-party
account-owned resources directly. Suggested mutations from
ExternalPrincipals route through the delegated capability gateway and
output firewall.

Authentication does not grant protected App origin or operation authorization. A rejected bearer cannot fall back to anonymous execution or bypass the native Host boundary.

## Source Basis

- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
