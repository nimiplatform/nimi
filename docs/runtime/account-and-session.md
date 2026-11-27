<!-- nimi-docs: {"authority":["rule.nimi.runtime.remote-access.source-admission","rule.nimi.runtime.remote-access.primary-control"],"sources":["sdks/typescript/realm/runtime-client.ts","kit/core/src/app-session.ts"]} -->

# Account Authentication and Protected App Sessions

In the Nimi architecture, universal user identity and account authorizations are authoritatively issued by Realm. The local `RuntimeAccountService` coordinates browser authorization flows, authorization code exchanges, session refreshes, and protected credential custody. Desktop launches the system browser and assists with loopback callbacks, keeping bearer credentials confined to protected Runtime custody rather than exposing them to frontend renderers.

## Authentication Flow and Handshake Sequence

1. **Transaction Request**: Nimi Home requests a new authentication transaction from `RuntimeAccountService`.
2. **Browser Launch**: Desktop opens the official authentication URL in the default system browser.
3. **Realm Verification**: The user signs in through the browser and completes any required multi-factor or passkey verification.
4. **Callback Handshake**: The browser redirects the authorization code via the transaction's dedicated loopback callback to the local Runtime.
5. **Credential Custody**: Runtime verifies and exchanges the code with Realm for durable credentials, storing them in protected local storage.
6. **Session Activation**: Home receives the ready signal and presents the active account context to the user.

## Protected Session Isolation for Applications

Apps launched through Nimi Home establish a protected session binding through the official SDK:
- **Implicit Context Derivation**: Runtime derives caller identity, application ID, and admitted permission scopes directly from the supervised peer connection. Apps never manage raw bearer tokens.
- **Protected Token Custody**: Client apps never access raw Realm access or refresh tokens. Protected Nimi AI calls run through Runtime, while an app's own online services use their own data paths.
- **Boundary Enforcement**: Unmanaged standalone clients cannot bypass host supervision to claim application scopes, preserving protected channel access boundaries.

## Session Lifecycle Events and Offline Continuity

- **Local Identity vs. Online Credentials**: Runtime separates previously established trusted local sign-in custody from short-lived online Realm access and refresh tokens. When a signed-in device goes offline or cold-starts after the online access token naturally expires, Home stays signed in locally, authorized local data and prepared Local models keep working, and verified installed Apps may continue reusing their last verified official Registry approval for that exact installed target regardless of elapsed time while installation identity, account validity, and local authorization remain intact.
- **Silent Refresh and Ambiguous Refresh Recovery**: Runtime refreshes expiring online credentials in the background when reachable. If a refresh fails before dispatch (e.g., offline), Runtime defers refresh and keeps both local identity and recoverable refresh custody. If a refresh outcome is ambiguous or possibly rotated (post-dispatch transport loss, Realm 503 verification unavailability, or crash recovery across a pre-refresh fence), Runtime immediately clears and fences the potentially rotated online tokens without replaying them while retaining local sign-in identity; online Realm and protected Remote Access calls then report online-auth-required until fresh online re-authentication in Home succeeds (same-identity re-authentication preserves the local session generation).
- **Immediate Enforcement of Logout, Switch, Revocation, and Kill-Switch**: Explicit logout, account switching, confirmed revocation, ban, account deletion, or contract-invalid refresh atomically invalidates both online credentials and local authenticated identity, immediately fencing active App sessions and cancelling local work (external effects that already occurred cannot be undone). For verified installed Apps, an observed active kill-switch or absent Registry record immediately blocks new launch and bind even when later offline.
- **Technical Session Changes**: Session rotation or detaching an observer does not by itself revoke work already admitted under a finite Job permit. Reading results still requires current authorization.

## Remote App Identity and Source Confirmation

Web and Android use official Runtime-client browser login to establish a scoped App context, then discover the account-bound primary Runtime. Registry owns source qualification; Runtime owns first source confirmation and per-operation access. A website domain, App name or self-declared role cannot substitute for those decisions.

Kit separates identity views from Runtime connection scopes: an unavailable PC does not mean the user signed out. Account switch, confirmed identity invalidation, source pause and connection loss retire the corresponding old scope. Confirmation is bound to Account, primary Runtime and source revision, not a separate per-device business grant. Ordinary Apps receive no generic Account bearer; Android retains only the short login transaction and keeps current context in memory. See [Shared App Sessions](/platform/kit/use-kit-in-app).

## Source Basis

- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`proto/runtime/v1/account.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/account.proto)
- [`.nimi/spec/platform/remote-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/remote-clients.authority.yaml)
- [`.nimi/spec/runtime/remote-access.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/remote-access.authority.yaml)
- [`kit/auth/README.md`](https://github.com/nimiplatform/nimi/blob/main/kit/auth/README.md)
