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

## Session Lifecycle Events

- **Silent Token Refresh**: Runtime attempts to refresh expiring credentials in the background. If renewal fails or user action is required, the session reports that state and protected operations follow the current access decision.
- **Account Switching & Logout**: Signing out or switching accounts immediately invalidates active app sessions and clears temporary buffers.
- **Technical Session Changes**: Session rotation or detaching an observer does not by itself revoke work already admitted under a finite Job permit. Reading results still requires current authorization.
- **Authority Withdrawal**: Signing out, switching accounts, or withdrawing the relevant App access or policy invalidates that work permit. Runtime fences further outbound work and result publication and cancels local work; it cannot undo external effects that already occurred.

## Source Basis

- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`proto/runtime/v1/account.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/account.proto)
