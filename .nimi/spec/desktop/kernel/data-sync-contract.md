# DataSync Non-Admission Contract

> Authority: Desktop Kernel

## Scope

Desktop does not admit a DataSync product/platform facade. Desktop is a Nimi
ecosystem app: it may compose product views and own bounded shell/scaffold
concerns, but it must not own Realm, Runtime, Cognition, SDK, or Kit truth.

`apps/desktop/src/runtime/data-sync/**`, `@runtime/data-sync`, `dataSync.*`
business methods, and any equivalent Desktop-local DataSync facade are
non-admitted. The `D-DSYNC-*` rules below define the final owner map for product
data responsibilities that would otherwise drift into Desktop.

## D-DSYNC-000 — Non-Admitted Facade Infrastructure

The DataSync facade infrastructure is not an admitted Desktop platform layer.

- Realm transport, auth custody, token refresh, generated service access,
  request parsing, and reason-code handling belong to SDK Realm/Platform Client.
- Reusable chat, commerce, shell, bridge, accessibility, UI, and headless
  interaction patterns belong to Kit.
- Desktop may keep bounded shell/scaffold adapters for offline cache, query
  invalidation, local upload placeholders, and product-specific view-model
  composition.
- Desktop shell/scaffold adapters must consume SDK/Kit public surfaces; they
  must not re-wrap generated Realm services as a second platform API.
- `globalThis` hot state may only preserve process/HMR continuity for admitted
  shell state. It is not session truth and must not carry durable auth custody.

## D-DSYNC-001 — Auth Owner Map

Auth credential exchange, session truth, token custody, and local first-party
Runtime account state belong to Runtime/Realm through SDK Platform Client and
Kit auth shell helpers.

- Desktop may wire auth UI intent and post-auth navigation.
- Desktop DataSync must not expose `login`, `register`, `logout`, password,
  OAuth, OTP, 2FA, or token-refresh authority.

## D-DSYNC-002 — Account/Profile Owner Map

Current-user, public-user profile, account settings, notification preferences,
creator eligibility, and account data actions are Realm truth surfaced through
SDK Realm helpers or SDK Platform Client domains.

- Desktop may own product-specific profile panels, form state, validation, and
  query invalidation.
- Desktop DataSync must not wrap `MeService`, `UserService`, `AuthService`, or
  account-data services as app-local platform access.

## D-DSYNC-003 — Human Chat Owner Map

Human chat canonical truth belongs to Realm. Typed chat access, realtime event
assembly, composer adapters, timeline parsing, and reusable chat primitives
belong to Kit/SDK.

- Desktop may own local offline cache/outbox scaffold, upload placeholders,
  selected-chat UI state, and product-specific query wiring.
- Desktop human chat UI must consume Kit Realm chat helpers or a bounded
  Desktop scaffold that itself consumes Kit/SDK public surfaces.
- Desktop DataSync must not expose `loadChats`, `startChat`, `loadMessages`,
  `sendMessage`, `syncChatEvents`, `flushChatOutbox`, or `markChatRead`.

## D-DSYNC-004 — Social Owner Map

Relationship graph, friend requests, block state, social snapshots, and
friend-quota truth belong to Realm. Reusable typed access belongs to SDK or Kit
headless surfaces.

- Desktop may own relationship UI, confirmation dialogs, optimistic query
  invalidation, and local offline mutation scaffold.
- Desktop DataSync must not remain the product authority for relationship or
  social graph operations.

## D-DSYNC-005 — World Owner Map

World list/detail/history/lore/binding/scene/audit canonical truth belongs to
Realm. Typed read helpers belong to SDK; reusable world display/headless
composition belongs to Kit when shared by multiple apps.

- Desktop may own product page composition and navigation state.
- Desktop DataSync must not act as a second world service registry.

## D-DSYNC-006 — Economy Owner Map

Economy canonical truth belongs to Realm. Desktop economy surfaces consume Kit
commerce Realm helpers from `@nimiplatform/kit/features/commerce/realm` for
balances, transaction history, subscription reads, Spark checkout, withdrawal,
gift actions, and gift review writes.

- Desktop may own Wallet/Notification/Gift UI state, query cadence, checkout
  redirect handling, and user-intent wiring.
- Desktop DataSync must not expose economy facade methods or re-wrap
  `EconomyCurrencyGiftsService` / `ReviewsEconomyTrustService`.

## D-DSYNC-007 — Feed/Resource Owner Map

Post, feed, like, moderation-report, resource-upload, and attachment truth
belong to Realm. Upload transport helpers and request builders belong to SDK;
reusable composer/headless primitives belong to Kit.

- Desktop may own create-post modal state, local attachment previews, query
  invalidation, and product-specific error presentation.
- Desktop DataSync must not remain the canonical post/resource facade.

## D-DSYNC-008 — Explore Source Discovery Owner Map

Explore search, public recommendation, public source profile, and discovery feed
truth belong to Realm. Typed helpers belong to SDK/Kit.

- Desktop may own Explore panel state and preview composition.
- Desktop DataSync must not wrap Search/Explore/source discovery services as app-local
  platform truth.

## D-DSYNC-009 — Notification Owner Map

Notification canonical list and read-state truth belongs to Realm. Desktop
notification surfaces consume SDK Realm notification helpers for unread count,
list, and read mutations.

- Desktop may own panel filtering, optimistic read overrides, and query
  invalidation.
- Desktop DataSync must not expose notification list/read mutations.

## D-DSYNC-010 — Settings Owner Map

Account settings, notification preferences, creator eligibility, password
updates, OAuth linking, and two-factor authentication truth belong to Realm.
Desktop settings surfaces consume SDK Realm account/settings helpers.

- Desktop may own settings form state, autosave timers, input validation,
  localized messages, and post-mutation query/session refresh wiring.
- Desktop DataSync must not expose settings/security/OAuth facade methods.

## D-DSYNC-011 — Source Owner Map

Creator source lists and public source profile reads belong to Realm. LocalAgent
execution, local lifecycle, LLM routing, memory, and Runtime substrate
state belong to Runtime/Cognition.

- Desktop may own source display pages but not Realm source creation surfaces.
- Desktop DataSync must not own LocalAgent LLM route, memory, lifecycle, or mixed
  runtime/realm authority.

## D-DSYNC-012 — Transit Owner Map

World transit canonical state belongs to Realm and admitted Runtime/Realm
workflow contracts. Typed access belongs to SDK/Kit when reused.

- Desktop may own transit UI intent wiring and display state.
- Desktop DataSync must not remain the transit service authority.

## D-DSYNC-013 — Replacement Path Guidance

Owner selection order is mandatory:

| Responsibility | Owner |
|---|---|
| canonical Realm business truth | Realm |
| Runtime execution, readiness, state, jobs, local lifecycle | Runtime |
| memory/knowledge/skill access policy and records | Cognition |
| typed access, schemas, decoders, transport, method IDs, request builders, response parsers, stream assemblers, test harnesses, non-authoritative client orchestration | SDK |
| reusable UI, shell, bridge, accessibility, token, headless product primitives | Kit |
| product screens, user-intent wiring, view-model composition, ephemeral UI state, bounded OS helpers | Desktop |

When a shared surface exists for a product data responsibility, Desktop must
consume that surface and Tester must prove it through a materially different
consumer flow. If no shared surface exists, the owning layer must define it
before Desktop can consume the responsibility.

## Fact Sources

- `tables/data-sync-flows.yaml` — DataSync non-admission owner map
