# Instance Lifecycle

An Avatar instance is an active desktop application process that presents a Runtime-authorized LocalAgent. The launcher can also reattach to an existing Avatar instance. Agent session continuity and binding associations are authoritatively managed by Runtime; the Avatar shell manages local windowing and renderer lifecycles.

## Launch Target

The caller submits an `AvatarHostHandoffRequest` through the formal Avatar Host port. Its `target` identifies the current session's Agent and, when needed, the exact Conversation. The target fields are:

| Field | Input | Purpose |
| --- | --- | --- |
| `agentHandle` | Required string | Current-session handle matching `agent_ref_` followed by 43 base64url characters; revalidated through the caller's App session and Runtime |
| `conversationAnchorId` | Optional string or `null` | Exact Conversation anchor, when the caller supplies one |
| `avatarInstanceId` | Required key; string or `null` | Untrusted hint for an existing Avatar instance |
| `launchSource` | Required key; string or `null` | Bounded source label; does not authorize an action |
| `switchIntentRef` | Required key; string or `null` | One-time reference returned with a switch confirmation request; resubmit only after user confirmation |
| `committedPresentationRef` | Required key; string or `null` | Opaque reference to a committed presentation |
| `temporaryCustodyRef` | Required key; string or `null` | Opaque reference to temporary custody |

Use `null` for nullable fields when no value applies. Every field remains untrusted targeting intent until the caller's App session and Runtime revalidate it. Raw Agent identifiers (`agentId`), account credentials, Realm endpoints, session histories, model files, calibration parameters, and local paths are excluded. Only the Desktop Host launches or focuses the native Avatar process and authorizes materialization under the protected data root.

The renderer receives a separate launch context containing `agentHandle`, a required `conversationAnchorId`, and nullable `avatarInstanceId` and `launchSource`. It receives no Host-private target reference or account credentials. The handed-off handle remains a targeting hint; it must not be reused as an Agent selector in Avatar's own App session.

## Session and Conversation Binding

Runtime owns Agent identity and Conversation continuity. Desktop keeps the private launch and instance information needed by the native host. Avatar first verifies its credential-free protected App session, then uses the exact handed-off Conversation anchor to resolve an Agent handle minted for that session. Operations use this session's handle and typed Runtime results.

A missing or invalid session, launch context, or Runtime binding prevents product interaction. The shell displays diagnostic information so the caller can restore the session or retry.

## Readiness and Local Diagnostics

Avatar chooses its shell view from the current session, driver, model, and launch prerequisites. The current App-local `CompositionState` values help diagnose that choice:

| Diagnostic value | Meaning |
| --- | --- |
| `loading` | Shell or Runtime preparation is incomplete |
| `ready` | Session, driver, and model prerequisites permit the product view; interaction also requires a ready backend presentation |
| `fixture_not_verified` | A development model can render, but product readiness remains false |
| `degraded_reauth_required` | The protected App session needs authentication or renewal |
| `degraded_cloud_offline` | The required Realm transport is unavailable |
| `degraded_runtime_unavailable` | A Runtime binding, driver, or model prerequisite is unavailable; inspect the diagnostic reason |
| `degraded_launch_context_invalid` | The renderer launch context failed validation |
| `error_bootstrap_fatal` | Bootstrap failed with an error outside the classified session, launch, or Runtime failures |

The model view mounts when the local composition is `renderable`. This includes an explicitly marked development preview, which cannot accept product interaction and does not prove a valid Runtime binding. Product interaction and the Companion surface additionally require Runtime-backed composition and a ready backend presentation. When prerequisites prevent rendering, Avatar shows the relevant diagnostic view.

## Typical Scenario: Launching Avatar from Desktop

1. **Submit the target**: The caller sends the current session's `agentHandle` through the Avatar Host port, with the exact Conversation anchor when needed.
2. **Revalidate the request**: Desktop and Runtime validate the caller and target. Desktop launches or focuses the matching instance; switching to another Agent requires user confirmation and the returned one-time switch reference.
3. **Resolve the session's Agent**: Avatar verifies its own protected App session, then resolves that session's Agent handle against the required Conversation anchor from the renderer launch context.
4. **Load authorized assets**: The Desktop Host authorizes materialization of the exact Runtime-validated visual package under the protected data root.
5. **Graphics initialization**: Avatar initializes the active graphics branch (e.g. Live2D) and awaits the first rendered frame.
6. **Enable interaction**: The shell enables product interaction when the session, driver, model, and backend presentation are ready.

Launch requests and renderer launch contexts carry no raw asset files, private keys, or account tokens.

## Typical Scenario: Runtime Becomes Unavailable

1. **Heartbeat failure**: A required Runtime service drops connection while Avatar is running.
2. **Show diagnostics**: The current Runtime binding or driver becomes unavailable, so product interaction stops and the shell shows the corresponding reason.
3. **Remove the product surface**: While the composition is not renderable, the model stage and Companion surface are unmounted.
4. **Retry**: Once Runtime is available, use the restart action to establish a fresh session. Interaction resumes only after the binding and presentation checks succeed.

## Ownership Summary

| Concern | Owner |
| --- | --- |
| LocalAgent cognitive execution and continuity | Runtime |
| Agent-handle and Conversation revalidation | Runtime through the caller's App session |
| Native instance launch, focus, and materialization authorization | Desktop Host Control Plane |
| Renderer launch-context validation | Avatar using the Kit parser |
| Desktop window lifecycle and interaction presentation | Avatar |
| Graphics resource compilation and teardown | Avatar backend branch |

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`kit/features/avatar/src/host-handoff-port.ts`](https://github.com/nimiplatform/nimi/blob/main/kit/features/avatar/src/host-handoff-port.ts)
- [`kit/features/avatar/src/launch-handoff.ts`](https://github.com/nimiplatform/nimi/blob/main/kit/features/avatar/src/launch-handoff.ts)
- [`apps/avatar/src/shell/renderer/app-shell/composition-state.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/composition-state.ts)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
- [`apps/avatar/src/shell/renderer/app-shell/app-bootstrap.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/app-bootstrap.ts)
- [`apps/avatar/src/shell/renderer/app-shell/avatar-session-agent-binding.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/avatar-session-agent-binding.ts)
