# Account and Protected App Sessions

Realm owns user identity and account authorization. RuntimeAccountService owns the local browser authorization transaction, code exchange, refresh, restart recovery, and credential custody. Desktop carries the browser launch and loopback callback; Web presents credential interaction. Neither renderer receives bearer material.

## Sign In Through Home

1. Home requests a login attempt from RuntimeAccountService.
2. Desktop opens the exact owner-issued URL in the browser.
3. The user completes the Realm-owned authorization through Web.
4. Desktop carries the validated callback to Runtime; Runtime alone exchanges the code and establishes local custody.
5. Home displays the bounded current-user and session projection.

Runtime unavailable, invalid callback, wrong transaction, or expired authorization fails closed. The renderer cannot assemble an alternate login URL or perform its own token exchange.

## App Access

A Desktop-supervised App receives the standard host-bound SDK surface. Runtime validates the exact launched Host peer and derives the registered App subject, account context, declaration generations, operation, and access. Localhost, an App ID, or a portable bearer is insufficient.

Apps consume safe status and typed capability results. They do not call a public `GetAccessToken`, hold Realm access or refresh tokens, or call Realm directly with a Runtime-issued bearer. Protected Realm operations use the typed broker; credential custody stays in Runtime. A direct SDK program outside the Nimi App contract has separately governed token custody and gains no protected App authority from it.

## Session Changes

Account switch, logout, registration changes, or access withdrawal invalidate affected ingress and references. A technical session rotation or observation disconnect does not itself cancel admitted finite Job work. True authority withdrawal fences new outbound work and unauthorized publication. Refreshing a session does not replay App tasks.

Logout is not account deletion. Local Cognition cleanup follows an actually observed, correctly correlated Realm account-deletion result; offline devices are not claimed to be physically erased remotely.

See [App authorization](/platform/agents/participation-authority) and [Job observation](/runtime/streaming).

## Source Basis

- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)

- [`proto/runtime/v1/account.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/account.proto)
