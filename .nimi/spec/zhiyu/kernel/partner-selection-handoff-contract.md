# Zhiyu Partner Selection Handoff Contract

## Z-PARTNER-001 No Partner Creation

Zhiyu must not create local partners, local agents, PersonaCharacters,
profiles, or character materialization truth.

It also must not issue Realm source-materialization packets, obtain/replace the
Runtime challenge audience, validate/upload packets, create snapshots, or
derive LocalAgent identity from CharacterSourceRefV3, WorldCharacter,
PersonaCharacter, or profile data.

## Z-PARTNER-002 Desktop/Realm Handoff

Partner creation and profile management are Desktop/Realm-owned. When no
partner is available, Zhiyu may request the admitted Platform/Desktop
`NimiDesktopOpenIntent`:

```ts
{ kind: 'open-explore', section: 'personas', productIntent: 'select-partner' }
```

The request must go through `desktop-open.openIntent` on the Kit standard shell.
Zhiyu must not construct Desktop URLs, emit `menu-bar://open-tab`, call
Desktop-private IPC, or claim success when Desktop is not running or not ready.
If the Desktop Open capability is unavailable, copy and affordance must reflect
the real fail-closed state instead of promising a fake deep link.

This action navigates to existing partner/source selection only. It is not
Zhiyu source-materialization authority. The source-generic materialization
intent and Character/Persona action belong to Desktop `rule.nimi.desktop.product-surfaces.r006` and `rule.nimi.desktop.product-surfaces.r007` and
`realm-source-materialization-actions.yaml`.

## Z-PARTNER-003 Current Partner Projection

The current partner shown in Zhiyu must come from admitted Runtime/Realm/Desktop
projection. Zhiyu must not use brand name, fixture name, or app-local state as
partner identity truth.

Availability may be presented only from bounded
`LocalAgentSourceContextStatus` plus admitted opaque inventory/provenance.
Unknown/partial status never becomes a current or ready partner. Zhiyu stores
no raw source/profile/context cache and creates no alternate identity mapping.
