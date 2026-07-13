# Grant Service Contract

> Owner Domain: `K-GRANT-*`

## K-GRANT-001 Public Grant Family Hardcut

The former public credential-grant service has been removed from proto,
generated clients, SDK exports, Runtime handlers/registration and persistence.
Its wire and field identities are reserved and must not be reused or recreated
under aliases.

No public TCP, loopback gRPC, renderer IPC, ordinary SDK client, app-owned host,
Desktop bearer, request-body consent, parent-token possession, scope claim, or
portable session may revive this family.

## K-GRANT-002 Runtime-Private Grant Evaluation

Runtime may evaluate protected operations only inside its own security
principal, after the admitted protected transport has established a
Runtime-derived live origin and the operation-specific policy has authorized
that origin. Such evaluation:

- is a private Runtime call path rather than a `RuntimeGrantService` transport;
- does not mint or return a reusable protected credential to Desktop, SDK,
  renderer, app, or another ordinary local caller;
- cannot be authorized by a caller-supplied `confirmed`, consent boolean,
  principal id, token id, scope list, resource selector, or delegation chain;
- records fail-closed authorization and audit state in Runtime-owned protected
  storage; and
- may expose only typed operation results and redacted status projection.

The final local-app grant binding and evaluator input are defined by
K-GRANT-014. No public credential family is required or permitted.

## K-GRANT-003 Removal And Drift Boundary

The authoritative removal is closed across:

- `tables/runtime-rpc-auth-posture/identity-access.yaml`;
- `tables/protected-local-rpc-transport-matrix.yaml`;
- `tables/rpc-methods.yaml`;
- `tables/rpc-migration-map/methods-identity-app.yaml`; and
- `../../sdks/kernel/tables/runtime-method-groups.yaml`.

Any active SDK export, auth posture, transport/origin admission, generated
symbol, handler, protected credential response or product caller for the
removed family is authority drift and must fail validation.

Former public grant, delegation, scope-catalog, token-chain, and request-body
consent behavior is retired pre-cutover authority history available from Git;
it is not active product truth and must not be copied into a new facade.

## K-GRANT-014 PC-local App Account Grant

Runtime owns one protected `AppAccountGrant` lifecycle keyed by
`local_os_user_anchor + account_id + local_app_principal_id +
capability_resource_fingerprint`. The schema and exact state transitions are
defined by `tables/local-app-grant-binding-schema.yaml`.

Principal/project/package admission and provenance promotion create zero grant.
`LocalAppRecord` contains no grant boolean. Publisher tier, app id, provenance,
catalog presence, session existence, or operation request cannot substitute for
an active exact grant. Account switch never transfers it; uninstall/project
revoke tombstones the principal and leaves no grant inheritance.

A valid zero-grant local-app session may read redacted permission posture and
request Desktop-owned grant UX. Grant create/expand consumes the exact Runtime-
issued presence challenge. Revoke/expire/supersede changes the grant revision
without rotating the identity session; the next protected operation reads the
current revision and denies or allows through the provenance-agnostic
K-ACCSVC coordinator plus the domain owner policy.

The grant store is separate from principal/record and launch/session stores.
No dual read/write, app-id positive fallback, cloud grant prerequisite, public
token, bearer, portable grant credential, or app/renderer mutation surface is
admitted.
