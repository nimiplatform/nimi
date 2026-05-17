# How To Write Fail-Close Acceptance Invariants

You want your packet's `acceptance_invariants` to actually fail
closed instead of being soft "shoulds." The methodology refuses
soft invariants; this recipe shows how to write hard ones.

## Recipe

1. **State the invariant as a verifiable predicate.** Not "this
   should be readable"; "every retained docs/**/*.md path is
   reachable from sidebar (or nav) in at least one locale."
2. **Name the verification mechanism.** Grep, dev server inspection,
   build pass, etc.
3. **Make the failure mode explicit.** What does failing this
   invariant look like? Be concrete.
4. **Pair with a `negative_tests` entry.** Negative tests catch
   violations grep-style; invariants are positive predicates.
5. **Cross-check with `forbidden_shortcuts`.** If the invariant's
   negation is one of the catalog patterns, declare both.

## Soft Vs Hard

| Soft (refuse) | Hard (admit) |
| --- | --- |
| "Pages should be readable" | "Each retained sub-page contains at least one concrete reader scenario" |
| "Avoid forbidden claims" | "Forbidden-marker grep returns zero hits across `README.md` and `docs/**`" |
| "Build should work" | "`pnpm docs:build` PASS" |
| "No spec drift" | "`.nimi/spec/**` remains unchanged (verified by `git status -- .nimi/spec`)" |

The soft form cannot be mechanically checked. The hard form can.

## Reader Scenario: Converting Soft To Hard

A first-draft packet has:

```
acceptance_invariants:
  - Documentation should be readable
  - Sidebar should expose all sub-pages
  - Build should pass
  - No spec drift
```

These are all soft. Convert:

```
acceptance_invariants:
  - Each retained docs/**/*.md path is reachable from sidebar
    (or nav) in at least one locale
  - Each retained sub-page carries at least one concrete
    scenario or worked example tied to a kernel rule family
  - Sidebar /<section>/ group exposes all sub-pages plus
    explicit Related cross-links
  - pnpm docs:build PASS
  - .nimi/spec/** remains unchanged (verified by git status)
```

Each is now a verifiable predicate.

## Reader Scenario: Pairing With Negative Tests

The invariant "no concrete provider name introduced" pairs with:

```
negative_tests:
  - grep -rEni '\b(OpenAI|Anthropic|Claude|Gemini|GPT-[0-9]|...)\b'
    returns zero hits across README.md and docs/**
    (excluding the meta-doc forbidden-claims.md)
```

The negative test is a concrete grep; the invariant is the
positive shape.

## Reader Scenario: Cross-Check With Forbidden Shortcuts

The invariant "no parallel truth introduced" pairs with declared:

```
forbidden_shortcuts:
  - dual_read
  - dual_write
  - app_local_shadow_truth
  - silent_owner_cut_reopen
```

The catalog keys are what the audit checks against; the
invariant is what the work positively achieves.

## What To Watch For

| Symptom | Meaning |
| --- | --- |
| Invariant phrased as "should" | Soft; refuse, rewrite as predicate |
| No verification mechanism named | Cannot fail-close |
| Failure mode unclear | Reviewer cannot verify |
| Missing negative test pair | Catch only positive case; missing the symmetric |

## Source Basis

- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/packet.schema.yaml)
- [`nimi-coding/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/acceptance.schema.yaml)
- [`nimi-coding/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/forbidden-shortcuts.catalog.yaml)
- [`nimi-coding/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/four-closure-policy.yaml)
