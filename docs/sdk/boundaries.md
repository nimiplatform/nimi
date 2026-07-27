# SDK Boundaries

The SDK boundary exists to keep app integration stable and honest. It is
not only a convenience package. It is the line between public app-facing
behavior and private owner-domain implementation.

The kernel rules behind this page live under `S-BOUNDARY-*` and
`S-SURFACE-*`.

## The Boundary Rules

- Apps should use SDK public exports instead of private Runtime or Realm
  paths.
- SDK surfaces should not silently redefine Runtime, Realm, or Desktop truth.
- Package location, a source directory, or a docs page does not create a
  public SDK promise.
- A readable docs page is not enough to create a new SDK promise. The
  promise needs admission first; the page is a projection second.

## Why Boundary Violations Are Expensive

Boundary violations are expensive in AI products precisely because they
look harmless at first. A direct import, a local helper, a temporary
route — none of those breaks anything in the moment.

Over time those violations become structural. The app's behavior is
now coupled to internals it never admitted as part of its surface. The
app forms a local expectation of how Runtime or Realm behaves that may
not match the contract. Agents, apps, and docs drift from each other
because each is anchored to a slightly different reality.

## Reader Scenario: The "Just One Helper" Anti-Pattern

Suppose an app developer needs a small piece of formatting that already
exists in the runtime package. The convenient move is to import that
helper directly. The SDK boundary says no.

The reasoning is:

1. The runtime package's internals have no admitted external contract.
2. Importing from there silently imports an unstable shape.
3. The helper might disappear or change in the next runtime change set.
4. If the helper is generally useful, the right move is to admit it as
   part of an SDK surface, not to absorb a private import.

Refusing the import is not pedantry. It is what keeps the app's surface
stable and predictable.

## Reader Scenario: An App That Tries To Skip SDK

Suppose an app wants to call into Runtime directly for performance
reasons, bypassing the SDK projection. That is a different shape of the
same boundary violation.

- Apps consume Runtime through public SDK methods, not arbitrary runtime
  imports.
- Runtime-owned behavior must stay behind Runtime contracts and SDK
  projection.
- Calling Runtime internals directly skips the stable error, transport,
  and authority boundary the app is supposed to inherit.

The performance argument can be real. The right way to satisfy it is to
admit a new SDK pattern, not to slip past the boundary.

## What Belongs Inside The Boundary, And What Belongs Outside

Inside the boundary lives anything an app or external integration
can rely on as a stable promise:

- public SDK sub-paths and exports;
- documented runtime methods, world composition primitives, realm
  facade reads, scope projection;
- typed shared building blocks under `@nimiplatform/sdk/types`.

Outside the boundary lives everything that exists for runtime
implementation reasons:

- private runtime packages, internal client code, transport-level
  glue;
- private realm internals;
- Desktop internals or Runtime-private Memory and Knowledge implementation.

The boundary itself is documented in `.nimi/spec/sdks/client-core.authority.yaml`
and the TypeScript target export map.

## Source Basis

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`config/sdks-typescript-target-export-map.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/sdks-typescript-target-export-map.yaml)
