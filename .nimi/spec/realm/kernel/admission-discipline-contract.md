---
id: SPEC-REALM-KERNEL-ADMISSION-DISCIPLINE-001
title: Realm Admission Discipline Kernel Contract
status: active
owner: "@team"
updated: 2026-06-11
---

# Admission Discipline Contract

> Domain: admission-discipline
> Rule family: R-ADMIT

## Scope

This contract defines the meta-rule that governs what may enter Realm at all:
the two-layer cut between the unconditional core (identity, authentication,
account, permission grant) and the opt-in protocol families (world, social,
chat, feed, economy, asset, bundle, transit, and successors). It constrains
future admission decisions; it does not redefine any existing family's
semantics.

The discipline exists to keep both promises that justify mandatory login:
the core a user must unconditionally accept stays minimal, and everything in
Realm beyond it is there because its semantics demand multi-party
coordination — never because cloud placement was convenient or raised
engagement.

## R-ADMIT-001

A capability is admissible into a Realm protocol family only when its semantic
substance is inherently multi-party, cross-device, or cross-account — state or
coordination that cannot exist as a single-machine, single-account local fact.
Implementation convenience, login-rate or engagement objectives, and cloud-side
operational preference are not admissible justifications. A capability whose
semantics are satisfiable runtime-locally must remain runtime- or app-local
truth.

## R-ADMIT-002

The Realm core layer is permanently limited to identity, authentication,
account, and permission-grant authority (the `R-OAUTH` and `R-PERM` families).
Every other Realm capability family is an opt-in protocol family: an app that
declares no consumption of a protocol family must remain fully functional
without it, and protocol-family obligations bind only declared consumers.
Admitting a capability into the core layer requires demonstrating that
identity or grant semantics are unsatisfiable without it.
