---
id: SPEC-REALM-KERNEL-OAUTH-AUTHORITY-001
title: Realm OAuth Authority Kernel Contract
status: active
owner: "@team"
updated: 2026-05-09
---

# OAuth Authority Contract

> Domain: oauth-authority
> Rule family: R

## Scope

This contract defines the realm's role as the OAuth 2.0 authorization server for native and public clients within `Realm public projection boundary`. It governs the two endpoints that admitted native clients use to obtain account session material via the PKCE-protected authorization code flow.

This contract is the realm-side counterpart to `K-ACCSVC-008` `CompleteLogin` proof envelope in [`runtime/kernel/account-session-contract.md`](../../runtime/kernel/account-session-contract.md). Runtime is the authorized consumer; realm is the authority that issues authorization codes and exchanges them for session material.

This contract does not govern: third-party OAuth provider linking (covered by `/api/auth/oauth/login` `OAuthLoginDto`), session refresh (covered by `/api/auth/refresh`), wallet auth, password auth, or 2FA flows.

## R-OAUTH-001

Realm is the OAuth 2.0 authorization server for native and public clients in `Realm public projection boundary`. The PKCE-protected authorization code flow is the sole admitted method for native clients to obtain realm session material; no other OAuth flow is admitted on the endpoints governed by this contract.

## R-OAUTH-002

The admitted endpoint set is exactly two routes. `GET /api/auth/oauth/authorize` accepts an authenticated realm session cookie and either renders the login UI or redirects with an authorization code. `POST /api/auth/oauth/token` accepts `application/x-www-form-urlencoded` and returns JSON with session material. Implicit flow (`response_type=token`), client_credentials, password, device_code, and any URN-namespaced grant type are forbidden.

## R-OAUTH-003

`code_challenge_method` must equal `S256`. The value `plain` and any other value must fail-close with `invalid_request`. Missing `code_challenge` or missing `code_challenge_method` on `/authorize` must fail-close with `invalid_request`. PKCE is the sole security boundary for admitted clients on this contract; no fallback is admitted.

## R-OAUTH-004

Authorization codes are single-shot and short-lived. The lifetime from issuance at `/authorize` to consumption at `/token` must not exceed 60 seconds. Codes must be persisted in atomically-consumable storage: a relational row updated by a single `UPDATE ... WHERE consumed_at IS NULL ... RETURNING ...` statement, or a key-value primitive that supports atomic claim-and-delete in a single round trip. Any expired or already-consumed code at the `/token` endpoint must fail-close with `invalid_grant`.

## R-OAUTH-005

`redirect_uri` must satisfy all of: scheme `http`, host either `127.0.0.1` or `localhost`, port any value in `1..65535`, and path exactly `/oauth/callback`. The `redirect_uri` presented at `/authorize` must byte-for-byte equal the `redirect_uri` presented at `/token` exchange. Any other host (including `0.0.0.0`, IPv6 loopback `[::1]`, public IPs, or hostnames), any other path, any other scheme, and any mismatch between authorize-time and token-time `redirect_uri` must fail-close.

## R-OAUTH-006

At `/authorize` issuance time the authorization code is bound to: `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method`. At `/token` exchange the request must present matching values for all four binding fields. Any single mismatch must fail-close with `invalid_grant`. Binding is established at issuance and is immutable for the lifetime of the code.

## R-OAUTH-007

The admitted `client_id` set is closed and governed by [`tables/oauth-authority-contract.yaml#oauth_clients`](tables/oauth-authority-contract.yaml). No `client_secret` is accepted on either endpoint; admitted clients are public/native and PKCE is the sole security boundary against authorization code theft. Adding or modifying an admitted client requires extending the table and re-running spec governance gates; ad-hoc client provisioning is forbidden.

## R-OAUTH-008

Authorization codes (raw and any reversible encoding), `code_verifier`, issued `access_token`, and issued `refresh_token` must never appear in: structured logs, audit or event payloads, error response bodies, exception messages, telemetry attributes, or any other persisted observability surface. At-rest persistence of authorization codes must use a one-way HMAC-SHA256 keyed by a realm secret; raw codes must not survive past the issuing HTTP response. Error responses must communicate failure without echoing the offending code, verifier, or token bytes.

## R-OAUTH-009

The `/token` success response is a JSON body with the following normative shape:

```json
{
  "access_token": "<string>",
  "refresh_token": "<string>",
  "token_type": "Bearer",
  "expires_in": 0,
  "account_id": "<string>",
  "display_name": "<string>",
  "realm_environment_id": "<string>"
}
```

`refresh_token` is issued only when all PKCE, binding, lifecycle, and replay checks pass. Field names are normative and consumed by the runtime token exchanger; renaming or omitting any field is a breaking change that requires updating both this contract and the runtime account session contract.

## R-OAUTH-010

The following grant types are forbidden on `/api/auth/oauth/token` and must fail-close with `unsupported_grant_type`: `refresh_token` (use `/api/auth/refresh`), `client_credentials`, `password`, `urn:ietf:params:oauth:grant-type:device_code`, and any other URN-namespaced grant. Only `grant_type=authorization_code` is admitted on this endpoint.

## R-OAUTH-011

`/api/auth/oauth/authorize` requires an authenticated realm session cookie on the request. The realm uses a split UI/API topology: the API authorize endpoint owns the OAuth transaction; the apps/web `/login` page is a UI continuation only. If the request is not authenticated, the API endpoint must `302` to `${NIMI_WEB_URL}/login?oauth_next=<absolute-API-authorize-URL>`, where `oauth_next` is constructed from the canonical realm/API origin (`NIMI_REALM_URL`) plus the request's original URL so it is an absolute URL that the user agent can navigate cross-origin. The continuation parameter MUST be named `oauth_next` (not generic `next`) so apps/web can apply a strict OAuth-only allowlist without colliding with any unrelated post-login navigation. The web shell MUST validate the `oauth_next` URL against an allowlist of realm/API origins known to the web build before navigating; URLs on any other origin must be silently dropped to prevent open-redirect abuse. After successful login the web shell navigates the user agent BACK to the absolute `oauth_next` URL via `window.location.assign`, at which point the realm session cookie is presented to the API and the server issues an authorization code bound per `R-OAUTH-006` and returns a `302` to `redirect_uri?code=<code>&state=<state>`. The `state` parameter is mandatory at `/authorize` and is passed through verbatim in the redirect; realm must not consume or reinterpret `state`. The web shell MUST NOT parse the OAuth `code`, MUST NOT receive any access or refresh token, MUST NOT call the `/token` exchange endpoint, and MUST NOT relay tokens to the desktop loopback; the web shell is exclusively a login UI and continuation. Original `/authorize` query parameters (`client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method`, `state`, and `scope` if present) are preserved across the login flow because they ride inside the absolute `oauth_next` URL.

## R-OAUTH-012

The `/token` endpoint must atomically claim consumption rights on the authorization code before performing any further validation. The validation order is fixed: (1) atomic claim — the code is marked consumed in a single transaction that fails if the code is missing, expired, or already consumed; (2) verify `client_id` binding equality; (3) verify `redirect_uri` exact-match equality against binding; (4) verify `S256(code_verifier)` equals the bound `code_challenge`; (5) mint and return tokens. Failure at step 1 must return `invalid_grant` without exposing further detail. Failure at step 2, 3, or 4 leaves the code consumed and not retryable; this defends against verifier-guessing and concurrent replay. Implementations must not undo the consumption claim under any circumstance.
