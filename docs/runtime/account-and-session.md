# Account And Session

> Status: Running today. `RuntimeAccountService` owns the local
> machine's account session truth, custody, login lifecycle, and
> current-account authorization decisions under `K-ACCSVC-*`.

`RuntimeAccountService` is the runtime authority for **local
first-party account identity**: who is logged in on this machine,
which account is currently active, how login / refresh / logout flow,
and how short-lived access tokens get projected into admitted local
first-party apps.

## Authority Boundary

| Owns | Does NOT own |
| --- | --- |
| Local machine account session truth | App-side session state |
| Login / refresh / logout / switch lifecycle | App-issued tokens (apps don't issue them) |
| Refresh token custody | Refresh tokens being held by apps (apps may not hold them) |
| Daemon restart recovery | External principal sessions (those are `RuntimeAuthService`) |
| First-party short-lived app access-token projection | App workspace state |
| Current-account revalidation for protected local-app operations | Per-app conversation truth |
| Account `subject_user_id` derivation | Caller-supplied `subject_user_id` (the runtime never trusts caller-supplied subject identity) |

App session and external-principal session live in `RuntimeAuthService`
(`K-AUTHSVC-*`). The two services are not interchangeable.

## Method Surface

`RuntimeAccountService` methods are **frozen**:

| Method | Purpose |
| --- | --- |
| `GetAccountSessionStatus` | Current account session state |
| `SubscribeAccountSessionEvents` | Event stream of session transitions |
| `BeginLogin` | Start a login attempt |
| `CompleteLogin` | Complete the login proof |
| `GetAccessToken` | Get a runtime-issued short-lived access token |
| `RefreshAccountSession` | Proactive / reactive session refresh |
| `Logout` | Revoke local credentials + current app authorization state |
| `SwitchAccount` | Atomic active-account switch |

New methods require an explicit kernel rule admission. The set is not
extensible by app convention.

## Session State Machine

| State | Meaning |
| --- | --- |
| `anonymous` | No account session |
| `login_pending` | A login attempt is in flight |
| `authenticated` | Valid account material + projection |
| `refresh_pending` | Refreshing account material |
| `expired` | Material expired; cannot authorize work |
| `reauth_required` | Needs user action to continue |
| `switching` | Atomic active-account switch in progress |
| `logging_out` | Revoking local material + current app authorization state |
| `unavailable` | Cannot safely decide / custody account state — fail-close |

**Single-active-account invariant:** one Runtime instance has at most
one `authenticated` account at a time. `SwitchAccount` is atomic;
two valid account projections cannot coexist.

## Why Apps Don't Hold Refresh Tokens

The refresh token is the durable auth secret. If apps held it, every
admitted local first-party app would be a separate refresh-token
custody site — every app would have to implement secure storage,
every app would be a separate compromise vector, and revocation
would need to fan out per app.

Runtime owns refresh token custody once. Apps get short-lived
access tokens via `GetAccessToken` and use them directly with
admitted Realm data APIs. When the access token expires, the app
asks the runtime for a new one. Refresh stays in the daemon.

## Reader Scenario: Login On A Fresh Machine

1. **State `anonymous`.** No session exists.
2. **App calls `BeginLogin`.** Runtime emits `login.started`; state
   moves to `login_pending`. The app receives a pending attempt
   handle; repeating `BeginLogin` before expiry returns the same
   pending attempt.
3. **User completes the proof** (web flow / device code / etc.).
4. **App calls `CompleteLogin`.** Runtime validates the proof,
   writes account material into custody, and emits
   `login.completed` + `account.status`. State moves to
   `authenticated`.
5. **App calls `GetAccessToken`** when it needs to talk to Realm.
   Runtime returns a short-lived token.

The app never saw the refresh token. The app never wrote auth
material to disk. The app does not own the account session.

## Reader Scenario: Token Refresh Mid-Use

An app is in the middle of a long-running operation; the access
token is about to expire.

1. **State `authenticated`.** App holds a short-lived access token.
2. **Refresh starts.** Runtime emits `refresh.started`; state moves
   to `refresh_pending`. Only one refresh per account is in flight
   at a time.
3. **Refresh succeeds.** Runtime atomically swaps the new token for
   the old one. Emits `refresh.completed` + `account.status`. State
   returns to `authenticated`.
4. **App's next `GetAccessToken` returns the new token.**

If refresh fails recoverably, state moves to `reauth_required`.
Current protected operations then fail closed until the account and
app session are re-established. The app cannot pretend the refresh
succeeded.

## Reader Scenario: Account Switch

A user has two Nimi accounts (work + personal) and switches.

1. **App calls `SwitchAccount`.** State moves to `switching`.
2. **Atomic transition.** Runtime invalidates the previous
   account's projection and admits the new account's projection.
   No moment of "two accounts authenticated."
3. **State returns to `authenticated`.** Subscribers receive
   `account.status` reflecting the new active account.

Apps that subscribed to `SubscribeAccountSessionEvents` see the
switch and re-derive their per-account state. There is no shared
"current user" string apps can read across accounts.

## Reader Scenario: Daemon Restart Recovery

1. **Daemon restarts.** All in-process state is lost.
2. **Account custody persists.** Refresh token + minimum required
   account state were durably stored by the runtime.
3. **State recovers** to `authenticated` (or `expired` /
   `reauth_required` per the durable state).
4. **Apps reconnect.** Subscribed apps receive an
   `account.status` event reflecting the recovered state. They do
   not have to re-prompt the user.

If the recovered state is `expired`, the app's next
`GetAccessToken` fails closed — no implicit re-login.

## Protected Local-App Authorization

A protected local app receives no portable account binding. Desktop
prepares a single-use launch lease, Runtime binds the exact native
process, and `RuntimeAuthService` opens a process-bound local-app
session on that verified carrier. For each protected operation,
Runtime revalidates the current account, App identity, process-bound
session, exact operation, and owner-specific resource selectors.

Logout, account switch, session expiry, process replacement, or
Runtime restart invalidates that current decision. A caller-supplied
app id, account id, LocalAgent id, or conversation id cannot restore
authority.

## What Account Service Does Not Do

- It does not proxy every Realm data request — admitted local first-
  party apps may continue to call Realm data APIs directly with the
  short-lived token.
- It does not own app session truth — that's `RuntimeAuthService`.
- It does not own external principal sessions — also `RuntimeAuthService`.
- It does not accept caller-supplied `subject_user_id`.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Local machine account session + custody + lifecycle | `RuntimeAccountService` (`K-ACCSVC-*`) |
| App session + external principal session | `RuntimeAuthService` (`K-AUTHSVC-*`) |
| Token validation (incoming bearer JWT) | AuthN token validation (`K-AUTHN-*`) |
| Token authorization / ownership (who owns what) | AuthZ ownership |

## Source Basis

- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
