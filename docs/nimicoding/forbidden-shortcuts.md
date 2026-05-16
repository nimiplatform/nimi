# Forbidden Shortcuts

Nimi Coding ships with a **package-owned catalog** of named
anti-patterns. Each shortcut is a specific failure shape the
methodology refuses, with a key the packet can reference.

This is one of the more distinctive engineering choices: the
catalog is open in the sense that topics may declare topic-local
extensions, but every refused pattern has a name. There is no
"miscellaneous bad pattern" bucket.

## The Catalog

| Key | What it forbids |
| --- | --- |
| `mvp_subset_contract` | Cutting canonical contract truth into a temporary minimum subset — full design must come first |
| `legacy_alias` | Keeping obsolete semantics alive via soft aliases — old must be hard-cut, not softened |
| `compat_shim` | Hiding owner-cut gaps behind temporary compatibility code |
| `dual_read` | Two parallel truth read paths without explicit admission |
| `dual_write` | Two parallel truth write paths without explicit admission |
| `placeholder_success` | Faking success or closure when required truth is missing |
| `happy_path_only_closure` | Claiming closure when only the happy path is closed |
| `time_phased_layering` | Replacing semantic layering (core / extended / custom) with time-sliced (v1 / v2 / v3) — methodology is ontological, not chronological |
| `app_local_shadow_truth` | App-local convenience state becoming hidden canonical truth |
| `silent_owner_cut_reopen` | Reopening owner-domain truth inside a downstream execution wave |

The 10 patterns in the package-owned catalog are the foundation.
Topics may declare additional topic-local extensions, but they
must use either package-owned keys or declared topic-local
extensions — not free-form prose.

## Why A Catalog Instead Of Free-Form Refusal

A free-form description of "things to avoid" is hard to enforce.
Reviewers may agree on the spirit but disagree on whether a
specific pattern matches. Audits cannot mechanically check
free-form rules.

A catalog turns "things to avoid" into typed keys. The packet
declares which keys it refuses; the auditor checks against the
declared set; the closeout's drift-resistance dimension verifies
they remain forbidden.

## Per-Pattern Detail

### `mvp_subset_contract`

A contract is admitted as a minimum subset, with the rest deferred
as "we'll add it later." The methodology forbids this because:

- "Later" is itself a form of `time_phased_layering`.
- A subset contract leaks the deferred concerns into implicit
  defaults.
- Consumers depend on the subset; future expansion becomes a
  breaking change masked as "completing the contract."

**Correct alternative**: design the full contract first; admit
ontology-layered (core / extended / custom) instead of
chronologically-layered (v1 / v2 / v3).

### `legacy_alias`

Old semantics are kept alive via soft aliases. The methodology
forbids this because:

- The alias is a parallel truth.
- It introduces silent compatibility burden.
- It makes the next refactor harder, not easier.

**Correct alternative**: hard cut. Either keep the old semantics
admitted as canonical, or remove. Aliases that pretend to be
"just for migration" become permanent.

### `compat_shim`

Owner-cut gaps are hidden behind temporary compatibility code.
This is `legacy_alias` for owner cuts. Same refusal.

### `dual_read` / `dual_write`

Two parallel truth read paths or write paths exist without
explicit admission. Forbidden because:

- The two paths drift.
- Apps consuming one don't see what the other does.
- "Migrating from one to the other" becomes a permanent state.

**Correct alternative**: explicit admission of dual-truth as a
deliberate transitional contract, with named timeline and
acceptance criteria for closing.

### `placeholder_success`

A typed contract failure is hidden behind a fallback that returns
"something" instead of failing closed. Forbidden because:

- Downstream code has no signal that anything went wrong.
- The "something" becomes a de-facto interface.
- Audit cannot detect the failure.

**Correct alternative**: fail closed with typed reason. Run-time
recovery is admitted only as transport / auth refresh, never as
contract rescue.

### `happy_path_only_closure`

Claiming closure when only the happy path is closed. The failure
modes are still implicit. Forbidden under semantic closure.

**Correct alternative**: pin failure modes explicitly before
declaring semantic closure.

### `time_phased_layering`

Layering by time (v1 → v2 → v3) instead of by ontology (core /
extended / custom). Forbidden because:

- Time-phased layers create permanent supersession churn.
- Each "next version" is a soft `legacy_alias` migration.
- Ontology layering is semantically stable; time layering is not.

**Correct alternative**: layer by what the abstraction means
(core vs extended vs custom), not by when it was added.

### `app_local_shadow_truth`

App-local convenience state becomes hidden canonical truth.
Forbidden because:

- The app's state diverges from canonical.
- Other apps disagree.
- Audit cannot reconstruct.

**Correct alternative**: app state is admitted as ephemeral and
local; anything that should persist as truth lives in the owner
domain.

### `silent_owner_cut_reopen`

Reopening owner-domain truth inside a downstream execution wave.
Forbidden because:

- Owner-domain mutations need their own admission.
- Mixing them into downstream execution hides authority drift.
- Audit lineage becomes unreconstructible.

**Correct alternative**: admit a separate owner-domain wave
first; then run the downstream execution against the updated
truth.

## How Packets Declare Forbidden Shortcuts

A packet's `forbidden_shortcuts` field lists the keys that
packet refuses:

```yaml
forbidden_shortcuts:
  - mvp_subset_contract
  - legacy_alias
  - compat_shim
  - dual_read
  - dual_write
  - placeholder_success
  - happy_path_only_closure
  - time_phased_layering
  - app_local_shadow_truth
  - silent_owner_cut_reopen
```

A topic may declare additional topic-local extensions:

```yaml
forbidden_shortcuts:
  # package-owned keys
  - mvp_subset_contract
  - legacy_alias
  # topic-local extension
  - sidebar_links_to_unwritten_pages
```

Topic-local extensions must be **declared** explicitly and named;
they are not free-form prose.

## Reader Scenario: A Wave Audit Catches A Forbidden Pattern

A wave under audit shows a `legacy_alias` pattern: the old route
was kept around "just for migration."

| Step | What happens |
| --- | --- |
| Auditor identifies | The pattern matches `legacy_alias` from catalog |
| Audit verdict | `NEEDS_REVISION` (or `FAIL` if blocking) |
| Worker addresses | Either remove the alias or admit it as explicit transitional contract |
| Re-audit | Verifies the resolution |

The catalog made the violation **named and typed**. There is no
ambiguity about whether the pattern is acceptable.

## Source Basis

- [`nimi-coding/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/forbidden-shortcuts.catalog.yaml)
- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/packet.schema.yaml)
