# False Closure Typology

False closure occurs when a Codex task appears complete while required
authority, semantics, consumer behavior, or drift resistance remains
open. The task state belongs to Codex; the methodology and gates define
what evidence must exist before Codex can honestly mark it complete.

## Build-Pass Closure

The code builds and tests pass, but the user-visible path is broken or
the changed consumer never uses the new implementation.

Required response: inspect the real runtime and consumer path, fix the
failure, and add regression coverage.

## Authority Closure Without Consumer Closure

The spec is correct and the owning SDK surface exists, but an app keeps
an old local path or bypass.

Required response: migrate the consumer to the canonical seam and remove
the parallel truth.

## Consumer Closure Without Authority Closure

The app behaves correctly, but the behavior relies on an undocumented
local rule that has no canonical owner.

Required response: resolve authority first. Do not promote working code
to product truth by implication.

## Happy-Path-Only Closure

The successful path works, while auth failure, runtime unavailability,
invalid input, disabled controls, or narrow layouts remain unverified.

Required response: test the declared failure and boundary states in the
real environment.

## Screenshot-Only Closure

A screenshot looks correct, but DOM state, accessibility, runtime
connectivity, or console behavior is wrong.

Required response: combine visual review with structural and runtime
inspection.

## Gate-Only Closure

Every mechanical check passes, but real application behavior contradicts
the checks.

Required response: treat the real behavior as the failure, fix it, and
strengthen the gate or regression test.

## Evidence-Free Closure

The final summary claims a check passed without a real command result or
runtime observation.

Required response: run the check. If it cannot run, report the block;
never manufacture a pass.

## Parallel-Truth Closure

The new owner path is implemented while an obsolete owner, read path, or
write path remains active.

Required response: complete the hard cut and verify the old path is no
longer reachable.

## Context-Compression Closure

A large change is declared understandable only because evidence or
implementation detail was compressed beyond reconstruction.

Required response: keep files cohesive, preserve traceable evidence, and
split responsibilities along real owner boundaries.

## Closure Check

Before Codex completes a high-risk task, the final evidence answers:

| Dimension | Question |
| --- | --- |
| Authority | Is canonical truth present and aligned? |
| Semantic | Does the implementation mean what the authority says? |
| Consumer | Do real consumers use the intended seam and behavior? |
| Drift resistance | Do tests and gates prevent the old failure from returning? |

An unanswered required dimension keeps the Codex task open or produces
an explicit blocked/partial outcome.

## Source Basis

- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/core.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/core.yaml)
- [`.nimi/contracts/negative-fixtures.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/negative-fixtures.yaml)
