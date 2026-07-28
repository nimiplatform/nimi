# Realm

Realm is the external server and domain authority for world truth. In this
repository, Nimi consumes Realm through the SDK Realm boundary instead of
redefining Realm server rules locally.

Runtime executes AI work. SDK gives apps an access boundary. Desktop and Web
render experiences. Shared world truth remains anchored in the external Realm
authority; Nimi-owned code works with typed consumer
projections.

## What This Section Contains

Realm consumer entry points:

- [Realm Truth Boundary](/realm/truth) — what Nimi does and does not own when
  consuming external Realm truth.
- [Realm Consumer Projection](/realm/projection) — how Nimi consumers receive
  Realm API output through the SDK boundary.
- [World State](/realm/world-state) — reader-facing context for current world
  state.
- [World History](/realm/world-history) — reader-facing context for append-only
  world history.

Domain reading map:

- [Chat](/realm/chat) — how conversation participates in Realm-backed meaning.
- [Social And Economy](/realm/social-and-economy) — relationship and value-flow
  concepts consumed from Realm.
- [Asset And Binding](/realm/asset-and-binding) — how app readers discuss world
  contents and attachments.
- [Transit](/realm/transit) — continuity concepts for movement between worlds.

Creator and app surfaces:

- [Creator Economy](/realm/creator-economy) — creator economy and settlement
  concepts.
- [App Interconnect](/realm/app-interconnect) — patterns for app-side Realm
  consumption.

For the side-by-side comparison of state vs history, see
[Platform → Worlds → State vs History](/platform/worlds/state-vs-history). The
cross-domain [Glossary](/reference/glossary) explains "world," "truth," and
"world history" if those terms are unfamiliar.

## Why Realm Matters To Nimi Apps

Nimi apps can operate in many surfaces: desktop, web, avatar, creator tools,
and world-specific extension apps. Those surfaces can show different views, but
they cannot invent Realm truth locally. They consume Realm through generated SDK
clients and typed facades.

If Realm output cannot be fetched, authenticated, decoded, or reconciled with
local projection state, the Nimi consumer must expose a typed unavailable/error
state. It must not synthesize Realm success.

## Reader Scenario: An App Reads Realm Data

1. **App requests Realm data.** The app calls through the SDK Realm facade.
2. **SDK uses generated Realm core.** The request shape comes from the
   configured external Realm OpenAPI input.
3. **Realm responds.** The external Realm authority owns the server/domain
   truth.
4. **Nimi projects the result.** Runtime, Desktop, Web, or app code may cache or
   present the output, but cannot make it canonical truth.
5. **Failures stay typed.** Missing token, endpoint, API drift, or unavailable
   Realm output fails closed instead of being synthesized locally.

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
