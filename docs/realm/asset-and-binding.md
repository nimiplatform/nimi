# Asset And Binding

Realm separates Resource, Asset, Bundle, and Binding into distinct
typed concepts. Most platforms collapse these into "files." Nimi
keeps them separate so a Resource can attach to many surfaces
without becoming an Asset, and an Asset can compose into a Bundle
without losing its independent ownership identity.

## Resource

The lowest typed content carrier.

| Property | Value |
| --- | --- |
| Types | `IMAGE`, `VIDEO`, `AUDIO`, `TEXT` |
| Identity | Stable |
| Storage | Realm-managed |
| Delivery | Typed |
| Status | Typed lifecycle (upload prep → finalize → delete) |
| Implies ownership? | No |

A Resource is just typed bytes with an id and a type. It doesn't
imply who owns it; it is not an asset by itself.

## OwnableAsset

An independently ownable formal object.

| Property | Value |
| --- | --- |
| Types | `WORK` or `ITEM` |
| Owner | Tracked |
| Authorship | Tracked |
| Lineage | Tracked |
| Lifecycle | `DRAFT → READY → ARCHIVED → DELETED` |
| Binding policy | Per-asset |
| `previewResourceId` | Separate from `resourceRefs` |

An OwnableAsset is **distinct from a Resource**. An asset has
ownership, authorship, and lineage in addition to whatever
resources it references. The `previewResourceId` is a separate
field for the preview image, kept apart from the asset's content
resources.

## Bundle

A formal composition unit — an ordered group of OwnableAsset
references.

| Property | Value |
| --- | --- |
| Identity | Stable |
| Owner | Tracked |
| Member ordering | Preserved |
| Cover asset | Separate from member list |
| Lifecycle | Ends at `ARCHIVED` (no `DELETED`) |

A Bundle composes assets but does not absorb them. Each member
asset retains its own ownership and authorship.

Note: Bundle lifecycle ends at `ARCHIVED` — there is no `DELETED`
state. A bundle that is no longer wanted is archived; the
underlying assets remain ownable and reusable.

## Binding

The only durable object-to-host relation. This is the typed edge
that says "this object is attached to this host in this way."

| Property | Value |
| --- | --- |
| Object types | `RESOURCE` / `ASSET` / `BUNDLE` |
| Host types | `WORLD` / `AGENT` / `SCENE` / `WORLD_EVENT` / `WORLDVIEW` |
| Binding kinds | `PRESENTATION` / `USE` / `IMPORT` |
| Legality | Matrix-governed; undeclared combinations rejected |

A binding has three free axes (object type, host type, kind), but
the **legality matrix admits only a subset** of combinations. An
undeclared combination fails closed.

This is what prevents "bind any asset to any host any way" sprawl.
A creator who wants to attach a Resource as `IMPORT` to an Agent
will discover whether that's an admitted legal combination.

## Attachment

A cross-surface display envelope only. Distinct from Binding.

| Concept | Authority |
| --- | --- |
| Binding | Realm canonical truth |
| Attachment | Cross-surface display envelope, not binding truth |

An attachment lets surfaces show "look, this is associated" without
implying a canonical binding. A binding is durable canonical truth;
an attachment is presentation glue.

## Reader Scenario: A Creator Publishes An Outfit

A creator wants to publish an outfit asset.

1. **Resources.** The creator uploads texture / mesh /
   metadata as Resources (`IMAGE`, etc.).
2. **OwnableAsset.** The creator creates an OwnableAsset of type
   `WORK` (or `ITEM` depending on use). The asset references the
   resources; ownership is the creator.
3. **Lifecycle.** Asset moves `DRAFT → READY` once the creator
   finalizes.
4. **Optional: bundle into a set.** The creator composes the
   outfit into a `Bundle` with several related assets. The
   bundle has its own owner and member ordering.
5. **Bind to a world or scene.** The creator binds:
   - Asset → Scene as `USE` (the asset is used in a scene).
   - Asset → Bundle as `IMPORT` (the asset is part of the bundle).
   - Bundle → World as `PRESENTATION` (the bundle appears in
     the world's presentation surface).
6. **Legality matrix.** Realm admits each binding only if it's
   in the admitted legality matrix.

The creator gets explicit legal use rights through the typed
matrix.

## Reader Scenario: An Illegal Binding Combination

A mod tries to bind a Resource directly to an Agent as `IMPORT`.

1. **Submit binding.** Mod sends the binding request.
2. **Realm validates.** Checks the legality matrix:
   `RESOURCE` × `AGENT` × `IMPORT`.
3. **Not admitted.** This combination is not in the matrix.
4. **Reject.** Fail-closed; typed error returned.
5. **Mod sees reason.** "This binding combination is not
   admitted; check the legality matrix."

The mod cannot accidentally violate a host type. The matrix is
declarative and enforced.

## Reader Scenario: An Asset Survives Bundle Archival

A creator archives a bundle that contained an asset.

1. **Bundle archived.** Bundle lifecycle moves to `ARCHIVED`.
2. **Member assets unaffected.** The OwnableAssets that the
   bundle composed remain `READY` or `ARCHIVED` per their own
   lifecycle.
3. **Reuse possible.** The creator can compose the same asset
   into a different bundle.

This is why Asset and Bundle are distinct concepts. Collapsing
them would mean archiving a bundle would orphan its content;
keeping them separate preserves reusability.

## Why Four Concepts Instead Of One

| Concept | What it answers |
| --- | --- |
| Resource | What are these typed bytes? |
| Asset | Who owns this thing as an independently-ownable object? |
| Bundle | What is this composed group of assets? |
| Binding | How is this object attached to that host? |

Collapsing them would lose the answers. A "file" abstraction can
not answer "who owns this composed group" or "is this a legal
attachment."

## Source Basis

- [`.nimi/spec/realm/asset.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/asset.md)
- [`.nimi/spec/realm/binding.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/binding.md)
- [`.nimi/spec/realm/kernel/asset-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/asset-contract.md)
- [`.nimi/spec/realm/kernel/binding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/binding-contract.md)
- [`.nimi/spec/realm/kernel/bundle-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/bundle-contract.md)
- [`.nimi/spec/realm/kernel/resource-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/resource-contract.md)
- [`.nimi/spec/realm/kernel/attachment-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/attachment-contract.md)
- [`.nimi/spec/realm/kernel/tables/asset-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/asset-contract.yaml)
- [`.nimi/spec/realm/kernel/tables/binding-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/binding-contract.yaml)
- [`.nimi/spec/realm/kernel/tables/bundle-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/bundle-contract.yaml)
- [`.nimi/spec/realm/kernel/tables/resource-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/resource-contract.yaml)
- [`.nimi/spec/realm/kernel/tables/attachment-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/attachment-contract.yaml)
