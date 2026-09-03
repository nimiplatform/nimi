# Realm

Realm is the server side of the Nimi ecosystem. It is where shared world
truth lives: accounts and identity, friendships, chat, money, worlds, and
the characters in them. Nimi does not re-implement any of that locally —
it connects to Realm through the SDK and plays by Realm's rules.

The split of labor is simple. Runtime executes AI work. The SDK gives apps
a safe way to reach Realm. Desktop and Web render the experience. The
shared truth of a world stays in Realm; Nimi code only ever works with the
typed view it receives.

## What This Section Contains

Realm consumer entry points:

- [Realm Truth Boundary](/realm/truth) — what Nimi does and does not own when
  consuming external Realm truth.
- [Realm Consumer Projection](/realm/projection) — how Nimi consumers receive
  Realm API output through the SDK boundary.
- [World State](/realm/world-state) — what the current state of a world is
  and how it changes.
- [World History](/realm/world-history) — the append-only record of what
  happened in a world.

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

A Nimi app can live in many places: Desktop, Web, Avatar, creator tools, or
an extension app built for one specific world. Each surface may show things
differently, but none of them get to invent shared truth on their own. They
all read Realm through generated SDK clients with typed wrappers.

If Realm data cannot be fetched, authenticated, or decoded, or it no longer
matches what the app last saw, the app has to say so — with a typed
unavailable or error state the user can see. It must never fake a successful
read.

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
