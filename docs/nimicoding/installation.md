# Nimi Coding Host Integration

The Nimi workspace pins `@nimiplatform/nimi-coding@0.6.1` as an exact
development dependency. A normal workspace install provides the CLI:

```bash
pnpm install
```

Run direct CLI calls from the repository root as `pnpm exec nimicoding ...` so
they resolve this pinned project-local package. Do not probe or depend on a
global `nimicoding` binary in `PATH`.

## Verify Managed Integration

```bash
pnpm nimicoding:sync
pnpm nimicoding:doctor
```

In this repository, `nimicoding:sync` runs `sync --check`; it verifies managed
files and marked instruction blocks without rewriting product authority or
host task state. `nimicoding:doctor` checks package and managed-surface
compatibility. Neither command validates the authority corpus, implementation
conformance, or task readiness.

`nimicoding start` is the initial host bootstrap for a new repository. It
creates only the documented authoring guide, managed instruction blocks, and
ignored `.nimi/local/` root. It does not create product authority, register a
task hook, or install a mandatory preflight. This Nimi checkout is already
initialized, so normal work uses the guarded `sync` and `doctor` scripts above.

The managed `AGENTS.md` and `CLAUDE.md` blocks tell an AI host which bounded
commands are available and where their claims stop. They are instructions, not
an execution wrapper. `start` and `sync` own only their exact managed paths and
marked blocks.

## Code Reads

The current 0.6.1 pin provides `code context` for a bounded outbound
TypeScript/TSX context and `code authority` for optional exact physical-line
markers in TypeScript, TSX, Go, Python, and Rust. Marker lookup does not prove
language comment context. These commands do not evaluate unannotated
implementation or prove conformance.

## Verify Product Authority

```bash
pnpm spec:authority:check
pnpm spec:authority:compile
pnpm spec:authority:audit
```

For an authority edit, follow
`.nimi/methodology/authority-authoring.yaml`: obtain bounded context, run
semantic diff and impact with explicit budgets, format every changed
authority file, and then check the complete `.nimi/spec` input set.

The configured audit evaluates only `.nimi/config/authority-verifiers.yaml`.
Its clear blocking status does not claim business-semantic completeness or
implementation conformance.

## File Placement

Nimi Coding host configuration belongs under `.nimi/config/**`. The managed
authoring guide remains under `.nimi/methodology/**`. Root `config/**` remains
appropriate for product schemas, generator inputs, and implementation
projections; referencing a canonical authority ID does not make such a file
Nimi Coding configuration or a second authority.

## Source Basis

- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
- [`.nimi/methodology/authority-authoring.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-authoring.yaml)
