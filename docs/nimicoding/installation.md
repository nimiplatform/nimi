# Nimi Coding Host Integration

The Nimi workspace pins `@nimiplatform/nimi-coding@0.5.0` as an exact
development dependency. A normal workspace install provides the CLI:

```bash
pnpm install
```

## Verify Managed Integration

```bash
pnpm nimicoding:sync
pnpm nimicoding:doctor
```

In this repository, `nimicoding:sync` runs `sync --check`; it verifies managed
files without rewriting product authority or host task state.

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
