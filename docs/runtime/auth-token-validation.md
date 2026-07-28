# Auth Token Validation

> Status: Running today. The bearer token validation surface
> (`K-AUTHN-*`) and authz ownership rules are shipped.

Runtime validates every incoming bearer JWT under `K-AUTHN-*` and
binds the validated identity to authz ownership rules. **AuthN**
asks "who is this?"; **AuthZ** asks "what is this principal allowed
to own / mutate?". The two are deliberately separate.

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
| Allowed algorithms | Allowlist (Phase 1: `RS256` / `ES256`) |
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
| Skew window | Fixed (Phase 1: `±60s`) |
| Beyond window | Token invalid; no soft tolerance |

A token within the skew window validates. Outside, it does not. The
runtime does not negotiate.

## Session Revocation Check

After signature validation passes, the runtime still checks session
revocation when the session domain is available.

| Rule | Value |
| --- | --- |
| Revoked / expired session | `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID` |
| Introspection endpoint | `auth.jwt.revocationUrl` |
| Required claim for introspection | `sid` |
| Missing config (`issuer` / `audience` / `jwksUrl` / `revocationUrl`) | Bearer JWT path fails closed |

The introspection contract is fixed: `POST` to `revocationUrl` with
JSON body containing `session_id`, `subject_user_id`, `issuer`,
`audience`, `issued_at`, `expires_at`. Response body must contain
`active: boolean`, `revoked: boolean`, optional `expires_at`.
`revoked=true` or `active=false` both count as revoked. Network
errors / non-2xx / malformed response **must NOT** degrade to
anonymous; they fail closed.

## AuthN vs AuthZ

The two stages are distinct and run in fixed order:

| Stage | Question | Failure code |
| --- | --- | --- |
| AuthN | "Is this token valid? Who does it represent?" | `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID` |
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

## Reader Scenario: A Valid Token Hits Realm Data

1. **App calls Realm data API** with the runtime-issued
   short-lived token in `authorization: Bearer <jwt>`.
2. **Runtime validates.** Header parses. Algorithm is allowlisted.
   `kid` resolves through JWKS cache. Signature valid.
   Claims (`iss`, `aud`, `sub`, `exp`, `iat`) all check; clock skew
   within window.
3. **Revocation check.** Session is active.
4. **AuthN passes.** Identity bound to the request.
5. **AuthZ runs.** The data operation is checked against ownership
   rules for the bound principal.
6. **AuthZ passes.** Operation proceeds.

## Reader Scenario: A Token With `alg=none`

1. **App sends header.** JWT has `alg=none`.
2. **AuthN rejects.** `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`.
3. **No fallback.** Runtime does not degrade to anonymous; the app
   sees the typed refusal.

## Reader Scenario: A Revoked Session

1. **Token validates.** Signature OK; claims OK.
2. **Introspection finds session revoked.** `revoked: true`.
3. **Runtime rejects.** `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`.
4. **App recovers** by going through `RuntimeAccountService` to
   re-authenticate.

## What Token Validation Does Not Do

- It does not invent a `subject_user_id` from caller-supplied data.
- It does not silently drop identity on header malformed.
- It does not accept `alg=none`.
- It does not allow JWKS refresh failure to degrade to anonymous.
- It does not allow introspection failure to degrade to anonymous.

## Source Basis

- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
