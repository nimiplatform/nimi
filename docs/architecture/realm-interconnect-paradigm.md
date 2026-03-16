# Realm Interconnect Paradigm: Building Beyond App Islands

> Version: 2026-03-03  
> Audience: app developers, world creators, platform architects  
> Objective: explain how Nimi Realm enables cross-app interoperability without turning the ecosystem into isolated islands

Spec mapping: [`spec/realm/app-interconnect-model.md`](https://github.com/nimiplatform/nimi/blob/main/spec/realm/app-interconnect-model.md)  
Chinese version: [`zh/architecture/realm-interconnect-paradigm.md`](../zh/architecture/realm-interconnect-paradigm.md)

## 0. One-Page Summary

Nimi is not trying to build "another giant app backend."
It addresses a more fundamental problem:
how independently built apps and worlds can preserve identity, relationships, context, and economic continuity across boundaries.

Core approach:

1. **App sovereignty stays intact**: each app keeps its own product logic, UX, and release pace.
2. **Realm provides a shared semantic layer**: only the minimum shared semantics and rules are centralized.
3. **Six primitives define interoperability contracts**: Timeflow / Social / Economy / Transit / Context / Presence.
4. **Adoption is optional and progressive**: apps can start with read-only integration and expand over time.

## 1. Problem: Why App Islands Cannot Form a Real Universe

When each app maintains its own identity, relationship, context, and economy models in isolation, four failures emerge:

1. Identity and relationships break when users move across apps.
2. Agent collaboration loses continuity across app boundaries.
3. Value transfer semantics become fragmented and hard to audit.
4. Creator ecosystems grow only inside single apps and fail to compound.

This is not primarily a product-quality issue.
It is a missing shared semantics issue.

## 2. Realm's Role: Shared Semantic Layer, Not App-Level Controller

In Nimi's architecture, Realm is positioned as:

- a shared truth layer for cross-app semantics (especially primitive execution semantics),
- an alignment layer for authorization, binding, rejection semantics, and audit,
- a stable interoperability interface, not a replacement for app-specific backends.

In short:  
**Apps create differentiated experiences; Realm guarantees interoperable semantics.**

## 3. Progressive Adoption: From Standalone to Deep Interconnect

Nimi does not require full Realm adoption from day one.
Apps can adopt in stages:

1. **Runtime-only (local intelligence first)**  
   Integrate local runtime first and close the single-app AI loop.
2. **Read-only interconnect (`render-app` mode)**  
   Consume shared semantics without world-write authority.
3. **Bound extension writes (`extension-app` mode)**  
   Write through explicit world binding and policy boundaries.
4. **Deep interoperability (six-primitive coordination)**  
   Align semantics across apps with primitive-level consistency.

So adoption can be incremental, not all-or-nothing.

## 4. Why the Six Primitives Matter

The six primitives are not a feature list.
They are the minimum shared contract for interoperability:

1. **Timeflow**: consistent temporal semantics, replayability, and drift governance.
2. **Social**: consistent relationship semantics and explainable admission/rejection.
3. **Economy**: conservation and settlement-window guarantees across app boundaries.
4. **Transit**: stateful migration semantics with actionable rejection hints.
5. **Context**: stable injection priority, truncation policy, and auditable handoff.
6. **Presence**: recoverable cross-device presence with deterministic merge.

Key point:  
Cross-app interconnect is not "copying data." It is preserving semantics.

## 5. Practical Developer Path

If you are an app developer, a minimal path is:

1. Choose your app mode first: `render-app` or `extension-app`.
2. Use SDK Realm entry with explicit instance isolation and auth strategy.
3. Bind all cross-app writes to explicit world relationship and scope boundaries.
4. Keep traceability fields (`trace_id`, `reason_code`, `app/principal`) on critical calls.
5. Align primitives incrementally, not in a big-bang migration.

## 6. Ecosystem Value

The value of Realm interconnect is not centralization.
It is enabling:

1. multi-team collaboration on shared semantics,
2. continuous user/agent experience across apps,
3. explainable and auditable auth/rejection/settlement semantics,
4. creator differentiation without sacrificing ecosystem connectivity.

## 7. Current Boundary (Pragmatic View)

In current specs, primitive-to-realm mapping is still converging (currently `PARTIAL`).  
This is an execution-phase reality, not a direction issue:
the ownership and boundaries are defined; the next step is shifting more semantics from "described" to "verifiable + gated."

## 8. Further Reading

1. Platform protocol overview: [`spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/spec/platform/protocol.md)  
2. Realm interop mapping: [`spec/realm/realm-interop-mapping.md`](https://github.com/nimiplatform/nimi/blob/main/spec/realm/realm-interop-mapping.md)  
3. Realm economy and boundaries: [`spec/realm/world-creator-economy.md`](https://github.com/nimiplatform/nimi/blob/main/spec/realm/world-creator-economy.md), [`spec/realm/creator-revenue-policy.md`](https://github.com/nimiplatform/nimi/blob/main/spec/realm/creator-revenue-policy.md)  
4. Rule mapping for this document: [`spec/realm/app-interconnect-model.md`](https://github.com/nimiplatform/nimi/blob/main/spec/realm/app-interconnect-model.md)
