# Mod Hub

Mod Hub is Desktop's single-page mod store: discover mods, install
them, update them, uninstall them, and manage installed mods —
all in one place. The catalog is GitHub-first and static; the
install chain is governed in 8 stages.

## What Mod Hub Surfaces

| Feature | Behavior |
| --- | --- |
| Catalog | GitHub-first static mod catalog |
| Discovery | Browse, search, filter mods |
| Install | 8-stage governed install chain |
| Update | Update an installed mod |
| Uninstall | Remove an installed mod |
| Installed list | Local installed-mods folder management view |

Mod Hub is the **single first-class entry into mod management**.
There is no separate "browser → installed" two-stage flow; one
page handles everything.

## The 8-Stage Governed Install Chain

When a user installs a mod, the install passes through 8 admitted
stages. Each stage has its own gate; failure at any stage fails
closed.

| Stage | Purpose |
| --- | --- |
| 1 | Catalog gates — mod is admitted in the catalog |
| 2 | Re-consent — user consent to install |
| 3 | Capability tier check — mod's declared tier admissible |
| 4 | Source verification — provenance check |
| 5 | Download | Fetch under admitted source |
| 6 | Verification | Checksum / signature validation |
| 7 | Ownership continuity — `mod id` global uniqueness |
| 8 | Advisory / revocation — final admit / revoke check |

A user who tries to install a mod that fails (for example) the
ownership-continuity gate gets a typed error — `mod id` collision
with another installed source. The install does not silently
overwrite.

## Mod Source Registry

| Source kind | Origin | Who admits |
| --- | --- | --- |
| `installed` | From admitted catalog | Catalog admission |
| `dev` | Filesystem path explicitly registered | User explicitly registers |

Users can only add `dev` sources; they cannot add arbitrary
`installed` sources. `dev` sources require Developer Mode and a
filesystem path the user has registered.

`mod id` is globally unique across enabled sources. A `dev`
source whose mod id collides with an `installed` mod fails closed.

## Top-Level Mods Tab Behavior

The puzzle icon in the sidebar navigates to Mod Hub. When
`enableModUi=false` (Web), the tab is invisible and the user falls
back to chat. Web mode does not silently expose mod surfaces.

## Reader Scenario: Installing A Mod From Catalog

You browse Mod Hub and find a mod you like.

1. **Click install.** Mod Hub initiates the 8-stage chain.
2. **Catalog gate.** Stage 1 admits the mod (it is in the
   catalog).
3. **Consent.** Stage 2 asks for your consent.
4. **Capability tier.** Stage 3 checks the mod's declared
   capability tier; if it is in your admitted tier, proceed.
5. **Source verification.** Stage 4 verifies provenance.
6. **Download.** Stage 5 fetches.
7. **Verification.** Stage 6 checks checksum.
8. **Ownership continuity.** Stage 7 confirms `mod id`
   uniqueness.
9. **Advisory / revocation.** Stage 8 final admit.
10. **Installed.** The mod is registered. Mod Workspace tab
    becomes available for it.

Each stage is a gate. A failure at any stage stops the install.

## Reader Scenario: Removing A Mod That Conflicts

You attempt to install a mod whose `mod id` collides with an
installed mod.

1. **Stages 1-6 pass.**
2. **Stage 7 fails.** Ownership-continuity violation: the
   `mod id` already exists.
3. **Install halts.** Typed error: "mod id collision with X".
4. **No silent overwrite.** Your existing mod is preserved.

Conflict resolution is explicit; the user chooses which mod to
keep.

## Reader Scenario: Adding A Dev Source

You are developing a mod locally.

1. **Enable Developer Mode.** In Settings; admitted as a typed
   user preference.
2. **Register a filesystem path.** As a `dev` source.
3. **Mod loads.** The mod at that path becomes a `dev`-source
   mod, subject to the same 8-stage chain (with appropriate
   adjustments for `dev` provenance).
4. **Hot reload.** Changes to the mod source can be picked up
   under the mod-development contract.

Dev sources are not the catalog; they are explicitly admitted
local paths.

## Source Basis

- [`.nimi/spec/desktop/mod-hub.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mod-hub.md)
- [`.nimi/spec/desktop/mods-panel.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mods-panel.md)
- [`.nimi/spec/desktop/mod-development.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mod-development.md)
- [`.nimi/spec/desktop/kernel/mod-governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/mod-governance-contract.md)
- [`.nimi/spec/desktop/kernel/tables/mod-kernel-stages.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-kernel-stages.yaml)
- [`.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml)
- [`.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml)
