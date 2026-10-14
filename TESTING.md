# Testing Strategy & Reference

Testing in Nimi follows a targeted, proportional approach: verify the immediate behavior being modified first, then run the nearest unit or integration test suite, expanding validation outward as needed.

This document serves as an operational reference for local testing and CI workflows.

---

## 1. Quick Component Verification

Run tests directly against the affected component:

| Changed Component | Immediate Verification Command | Expanded Scope (When Needed) |
| :--- | :--- | :--- |
| **Runtime (Go)** | `go test ./...` in the affected `runtime/` subpackage | `pnpm test:runtime:go` for full Runtime suite |
| **TypeScript SDK** | `pnpm --filter @nimiplatform/sdk test` | `pnpm --filter @nimiplatform/sdk build` and downstream consumers |
| **Kit (UI Components)** | `pnpm --filter @nimiplatform/kit test` | `pnpm check:nimi-kit` and design token checks |
| **Desktop Host** | `pnpm --filter @nimiplatform/desktop i18n:check` | `pnpm --filter @nimiplatform/desktop test` & `typecheck` |
| **Official Web Site** | `pnpm --filter @nimiplatform/web typecheck` | `pnpm --filter @nimiplatform/web build` |
| **Documentation** | `pnpm docs:build` | Builds the site; separately verify changed anchors, code examples, and reader journeys |
| **App Tools** | `pnpm --filter @nimiplatform/app-tools test` | Scaffolding and packaging tests |
| **Protocol Buffers** | `pnpm proto:lint` | `pnpm proto:drift-check` and `pnpm proto:breaking` |

---

## 2. Workspace-Wide Test Suites

When preparing for cross-cutting PRs or verifying branch health:

```bash
# Run unit and integration tests across all workspace packages
pnpm test

# Typecheck an affected package (for example Desktop)
pnpm --filter @nimiplatform/desktop typecheck

# Full CI simulation across scripts, proto, and workspace packages
pnpm test:workspace:full
```

---

## 3. Protocol & Breaking Change Verification

Protocol Buffers govern the wire format between Runtime and client SDKs:

- **`pnpm proto:breaking`**: Runs the configured wire breaking-change checks; see `scripts/proto-breaking.mjs` for the comparison baseline.
- **`pnpm proto:generate`**: Recompiles protobuf bindings for TypeScript, Go, and Rust.
- **Drift Checks**: Generated artifacts must match generator output exactly; hand-edited generated files will fail CI.

---

## 4. Product Acceptance & Target Platforms

Automated unit tests and type checks verify modular and static correctness, but do not replace full product acceptance:

- **End-to-End Verification**: User flows that have not been executed end-to-end on supported product paths remain marked as **`NOT-VERIFIED`**.
- **Target Hardware Validation**: Production packaging (`pack --production`) must be tested on the matching target OS and architecture (macOS arm64 or Windows x86_64) to verify native signatures and OS execution permissions. Note that packaging itself creates no OS sandbox.
