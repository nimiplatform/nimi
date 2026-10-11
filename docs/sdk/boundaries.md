# SDK Boundaries

The SDK boundary ensures application integration remains stable, predictable, and maintainable over time. It is not merely a collection of helper utilities, but an architectural firewall separating public application code from internal owner-domain implementations (Runtime, Realm, Desktop).

Core design specifications are detailed under `S-BOUNDARY-*` and `S-SURFACE-*`.

## Core Boundary Rules

- **Use public exports exclusively**: Applications must consume platform capabilities through the SDK's public subpaths, avoiding direct imports from private Runtime or Realm packages.
- **Preserve the single source of truth**: SDK surfaces project platform capabilities into idiomatic APIs without silently altering or redefining underlying authoritative state.
- **Formal contract adherence**: File locations, internal source trees, and unofficial notes do not constitute stability guarantees. Public promises are established through formal specifications and managed package exports.

## Why Boundary Violations Incur Heavy Technical Debt

Boundary violations often appear innocuous initially—importing a deep internal helper or issuing an ad-hoc socket request rarely breaks functionality on day one.

Over time, however, these shortcuts accumulate into severe architectural debt: application logic couples tightly to internal plumbing that offers no stability guarantees. When the underlying subsystem refactors or optimizes internal algorithms, the application breaks unexpectedly. Furthermore, bypassing the standard shell discards essential security session context, introducing subtle state drift.

## Typical Scenario: "Just One Internal Helper"

A developer needs string formatting or data serialization that happens to exist inside `runtime/internal/**`, and considers importing it directly:

1. **Risk profile**: Internal packages are subject to immediate refactoring, renaming, or deletion without deprecation cycles.
2. **Proper resolution**:
   - If the logic represents app-specific business utilities, implement it locally within the app;
   - If the capability serves general platform needs, propose its formal inclusion into `@nimiplatform/sdk` public exports.

Maintaining clear module boundaries is not academic pedantry; it ensures applications upgrade smoothly across releases.

## Typical Scenario: Bypassing the SDK to Query Runtime Directly

Attempting to bypass the SDK in pursuit of perceived performance gains or quick debugging:

1. **Missing security context**: The standard SDK client automatically carries security session credentials injected by the Desktop host. Bypassing the SDK results in direct RPC calls lacking origin authentication, causing immediate rejection by Runtime interceptors.
2. **Proper resolution**: Route requests through the host-bound client. If performance or streaming bottlenecks arise, address them by tuning SDK transport parameters or proposing official SDK API enhancements.

## Demarcation: Inside vs. Outside the Boundary

**Inside the Boundary (Stable, versioned public contracts):**
- Officially documented SDK subpaths and exported namespaces;
- Strongly-typed Runtime operations, world interaction primitives, and Realm canonical query APIs;
- Portable schema definitions and normalized error models under `@nimiplatform/sdk/types`.

**Outside the Boundary (Private subsystem implementations):**
- Runtime private packages, internal transport glue, and IPC handlers;
- Realm internal database schemas and state machine implementations;
- Desktop native window processes and private OS integrations.

## Source Basis

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
