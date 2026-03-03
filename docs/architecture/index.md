# Architecture Overview

Nimi consists of three developer-facing layers:

1. `nimi-runtime` (local AI execution)
2. `nimi-realm` (cloud persistent state)
3. `@nimiplatform/sdk` (unified developer interface)

## Boundary rules

- Apps consume runtime/realm through SDK.
- Mods consume capabilities through `nimi-hook`.
- Runtime/realm are independent and can be used separately.

## Next

- [Spec Map](./spec-map.md)
- [Protocol Reference](../reference/protocol.md)
- [Runtime Reference](../reference/runtime.md)
