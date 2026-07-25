# Frozen adjacency tables

These tables moved here from `.nimi/spec/<domain>/kernel/tables/` when the
authority root was purified (`173ab6463`). They are **not** authority: they are
data that authority units point at, held frozen until their owning disposition
package decides where they belong.

## Dispositions

| Family | Owner package |
|---|---|
| `runtime/tables/**`, `platform/tables/**` (protected-local family) | dev-kernel disentangle package |
| Realm broker tables | closed by the realm merge (`3c6aa9707`); the three activated tables now live in `config/` as consumer contracts |

## The freeze invariant

**Frozen means the semantics do not change — not that the bytes never change.**

Path strings *inside* frozen data are historical identifiers, not coordinates.
When a table moved, its data kept the original `.nimi/spec/...` strings byte for
byte, while the code that *reads* it was repointed. That distinction is what
kept the migration honest, and it still holds.

There is one deliberate exception, recorded here so a future audit does not
report it as byte drift:

- `runtime/tables/error-mapping-matrix.yaml` — its `fragments.mappings` list is
  a **reader coordinate**, not data. When the realm merge activated the
  `15-realm-broker.yaml` fragment as `config/runtime-error-mapping-realm-broker.yaml`,
  that entry had to follow the move or the matrix could not be loaded at all
  (it did not, for one commit: `check:runtime-proto-spec-linkage` crashed with
  ENOENT until `4db8dcd65` repointed it).

The rule this settles: a `fragments`/`$ref` entry is a coordinate and follows
its target; every other string in frozen data is an identifier and does not.
