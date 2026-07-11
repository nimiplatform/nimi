# Grant Service Contract

> Owner Domain: `K-GRANT-*`

## K-GRANT-001 Public Grant Family Hardcut

`RuntimeGrantService` is not an admitted product credential surface. The five
public wire symbols remain deny-all tombstones only until A.3d removes their
proto, generated, SDK, handler, registration, and persistence paths:

1. `AuthorizeExternalPrincipal`
2. `ValidateAppAccessToken`
3. `RevokeAppAccessToken`
4. `IssueDelegatedAccessToken`
5. `ListTokenChain`

No public TCP, loopback gRPC, renderer IPC, ordinary SDK client, app-owned host,
Desktop bearer, request-body consent, parent-token possession, scope claim, or
portable session may invoke or revive this family. Retaining a symbol during
the A.0-to-A.3d transition does not retain its former behavior.

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

The detailed private evaluator and replacement type surface are owned by A.3d.
A.0 admits only this boundary and does not claim that the replacement exists.

## K-GRANT-003 Removal And Drift Boundary

The authoritative deny-all projection is closed across:

- `tables/runtime-rpc-auth-posture/identity-access.yaml`;
- `tables/protected-local-rpc-transport-matrix.yaml`;
- `tables/rpc-methods.yaml`;
- `tables/rpc-migration-map/methods-identity-app.yaml`; and
- `../../sdks/kernel/tables/runtime-method-groups.yaml`.

Any active SDK export, anonymous/authenticated posture, non-empty transport or
origin admission, protected credential response, or product caller for one of
the five methods is authority drift and must fail validation.

Former public grant, delegation, scope-catalog, token-chain, and request-body
consent behavior is retired pre-cutover authority history available from Git;
it is not active product truth and must not be copied into a new facade.

## K-GRANT-004 Reserved Validate Tombstone

Reserved for A.3d deletion tracking; it admits no validation RPC or success response.

## K-GRANT-005 Reserved Delegation Tombstone

Reserved for A.3d deletion tracking; it admits no delegation RPC, parent-token authority, or active depth policy.

## K-GRANT-006 Reserved Revocation/Chain Tombstone

Reserved for A.3d deletion tracking; it admits no public revocation or chain visibility.

## K-GRANT-007 Tombstone Audit Boundary

Rejected calls are security events; this rule does not admit a public grant operation.

## K-GRANT-008 Reserved Scope-Catalog Tombstone

Reserved for A.3d deletion tracking; former public grant scope catalogs confer no capability.

## K-GRANT-009 Reserved Scope-Prefix Tombstone

Reserved for A.3d deletion tracking; matching a former prefix never authorizes an operation.

## K-GRANT-010 Reserved Scope-Revocation Tombstone

Reserved for A.3d deletion tracking; it admits no public token or scope mutation.

## K-GRANT-011 Reserved Chain-Request Tombstone

Reserved for A.3d deletion tracking; the former request fields have no admitted caller.

## K-GRANT-012 Reserved Chain-Response Tombstone

Reserved for A.3d deletion tracking; Runtime must not produce the former response publicly.

## K-GRANT-013 Tombstone Error Boundary

Any retained former error mapping is removal inventory only and cannot imply an active method.
