# Nimi SDK Architecture Boundaries

Status: non-authoritative AI handoff.

Spec Status: redesign aligned to `.nimi/spec/sdk/kernel/**`.
Authority Owner: `.nimi/spec/**`.
Work Type: SDK family architecture redesign.
Parallel Truth: forbidden. If this file conflicts with `.nimi/spec/**`, the spec wins.

Use this file when a new AI session needs to plan or audit the SDK refactor
without prior conversation context.

## Required Reading Order

1. Root `AGENTS.md`.
2. `.nimi/spec/INDEX.md`.
3. `.nimi/spec/sdk/kernel/index.md`.
4. `.nimi/spec/sdk/kernel/surface-contract.md`.
5. `.nimi/spec/sdk/kernel/boundary-contract.md`.
6. `.nimi/spec/sdk/kernel/package-governance-contract.md`.
7. `.nimi/spec/sdk/kernel/testing-gates-contract.md`.
8. `.nimi/spec/sdk/kernel/runtime-contract.md`.
9. `.nimi/spec/sdk/kernel/realm-contract.md`.
10. `.nimi/spec/sdk/kernel/ai-provider-contract.md`.
11. `.nimi/spec/sdk/kernel/tables/sdk-surfaces.yaml`.
12. `.nimi/spec/sdk/kernel/tables/runtime-method-groups.yaml`.
13. `.nimi/spec/sdk/kernel/tables/sdk-testing-gates.yaml`.

## Final Architecture

SDK is a multi-language family. TypeScript is one language implementation, not
the owner of SDK truth.

The required core language set is:

- TypeScript
- Python
- Go
- Rust

Core SDK means generated Runtime and generated Realm public interface coverage
plus behavior conformance for a language. A Runtime-only package, Realm-only
package, partial method package, manifest-only package, or skeleton-only
package is not a core SDK release.

Phase 1 core-family repository layout:

```text
sdks/
  generators/
  conformance/
  typescript/
  python/
  go/
  rust/
```

The current `sdk/` TypeScript package remains active for existing Desktop/Web
consumers and non-core SDK refactor work during Phase 1. Phase 1 does not move
it to `sdk/typescript`, does not switch Desktop imports, and does not create
forwarding packages, compatibility shims, or duplicate public roots.

Current TypeScript constraints, including the single npm package layout and
`@nimiplatform/sdk/*` subpaths, apply only to the pre-split TypeScript package.
They must not be used to reject `sdks/typescript`, `sdks/python`, `sdks/go`,
`sdks/rust`, `sdks/generators`, or `sdks/conformance`.

`tables/runtime-method-groups.yaml` is the TypeScript app-facing Runtime facade
grouping table. It is not the cross-language core method source and must not be
used as a selective omission authority for generated Runtime bindings.

## Surface Tiers

Every SDK file and public export must belong to one tier:

- `core-generated`: generated Runtime and Realm bindings, service registries,
  operation maps, method IDs, codecs, schema types, error tables, and export
  manifests.
- `core-client`: minimal language glue for transport, auth metadata, retry,
  timeout, cancellation, streaming, error classes, and typed facade assembly.
- `developer-experience`: request builders, response decoders, structured
  output helpers, stream assemblers, local tool-loop helpers, and mocks that
  stay non-authoritative.
- `ecosystem-adapter`: Vercel AI SDK, Agno, LangChain, or similar framework
  adapters over admitted public SDK surfaces.
- `test-support`: shared fixtures, fake transports, traces, and conformance
  harnesses.

If the tier is unclear, do not code. Write an authority fork note.

## Generation Rule

Core interface shape is generated first.

These are not hand-maintained SDK facts:

- Runtime method IDs.
- Runtime method allowlists.
- Runtime unary and stream codec maps.
- Runtime request / response contract maps.
- Realm operation maps.
- Realm service registries.
- Realm model maps and property enums.
- Reason-code tables.
- Core package export manifests.

If one language needs a missing core fact, fix proto, OpenAPI, spec tables, or
generator inputs first, then regenerate all affected languages.

## Derivative Services

Derivative services are allowed and important, but they do not define core
parity.

Examples:

- TypeScript Vercel AI SDK provider.
- Python Agno adapter.
- Python LangChain adapter.
- Framework-specific tool-loop adapters.
- Structured-output repair helpers.
- App-facing route or config helpers.

Derivative services release independently per language. They cannot replace
Runtime / Realm core coverage, and they cannot own provider routing, memory,
session, permission, lifecycle, app install, model catalog, or audit truth.

## Commit Boundary

SDK may assemble, parse, validate, stream, preview, or stage data locally.

SDK commits product truth only by calling the owning Runtime, Realm, Cognition,
or Platform operation through an admitted typed surface.

Any helper that persists truth, emits canonical lifecycle events, chooses
provider/model routing, writes memory/session/permission state, or enforces
cross-app policy belongs upstream of SDK.

## Conformance Model

Core tests are language-neutral.

The conformance model is a required release blocker, not an already implemented
runner. Do not add fake runnable gate commands before `sdks/conformance`
exists.

`sdks/conformance` owns:

- fixture inputs
- expected protocol traces
- fake Runtime / Realm transport behavior
- stream event traces
- error projection cases
- auth metadata cases
- timeout and cancellation cases
- release matrix definitions

Each language owns only its harness binding. A language is core-ready only when
the shared conformance matrix invokes that language's generated Runtime and
Realm clients through fake transports and passes for Runtime and Realm together.
Manifest parity, generated JSON count checks, and file-existence checks are not
completion evidence.

Derivative tests are separate. Adapter conformance proves external-framework
behavior and authority boundaries, not Runtime / Realm parity.

## Refactor Waves

Wave 0: Authority hardcut.

- SDK spec defines family architecture, tiering, generation rule, target layout,
  and conformance gates.
- Root handoff file points to spec and contains no independent authority.

Wave 1: Generated core and conformance foundation.

- Create `sdks/generators`.
- Create `sdks/conformance`.
- Admit concrete conformance runners before adding them to runnable gate tables.
- Generate per-language Runtime method clients, method IDs, method allowlists,
  codec maps, request/response contract projections, Realm operation clients,
  Realm operation maps, Realm service registries, Realm model/schema
  projections, error tables, and export manifests.
- Add shared conformance fixtures and fake transports that exercise generated
  clients before admitting non-TypeScript core packages.

Wave 2: TypeScript generated core implementation.

- Create the `sdks/typescript` generated Runtime / Realm core implementation
  from generated core facts.
- Delete hand-maintained mechanical core maps after generated replacements
  exist in the core family.
- Keep the current `sdk/` package active for Desktop/Web consumers and ongoing
  derivative TypeScript surfaces.
- Keep TypeScript DX, Vercel AI adapter, `@nimiplatform/sdk/ai-provider`, and
  `@nimiplatform/sdk/world` as derivative surfaces outside Phase 1 core
  readiness.
- Do not create forwarding packages or switch Desktop imports.

Wave 3: Python core.

- Implement generated Runtime and Realm core.
- Implement Python `core-client` glue only where generation cannot express
  language runtime behavior.
- Pass the full behavior conformance matrix through generated clients.
- Add Agno or LangChain adapters only after Python core passes.

Wave 4: Go and Rust core.

- Implement generated Runtime and Realm core for Go and Rust.
- Pass the full behavior conformance matrix through generated clients for each
  language.
- Add derivative adapters only after core readiness.

Wave 5: Derivative expansion.

- Add framework adapters and DX helpers per language.
- Each derivative surface has its own conformance and explicit unsupported
  capability behavior.
- No derivative surface can waive core conformance.

## Audit Checklist

For every SDK file under audit, answer:

1. Is this generated core, core-client glue, DX, ecosystem adapter, or
   test-support?
2. If it is core-generated, why is it not generated?
3. If it is hand-written, what language runtime behavior prevents generation?
4. Does it restate a Runtime, Realm, or spec fact?
5. Does it commit product truth or only call an authority service?
6. Does another language need this for core parity?
7. Is the test shared conformance or derivative-specific conformance?

Stop at audit if the owner is unclear.

## Non-Negotiables

- No legacy compatibility path.
- No forwarding package after cutover.
- No pseudo-success.
- No fake fallback.
- No language-local core truth.
- No app-level Runtime or Realm private bypass.
- No provider/model hardcoding.
- No derivative adapter claiming unsupported semantics as parity.
- No SDK-local durable memory, session, permission, lifecycle, or audit truth.
