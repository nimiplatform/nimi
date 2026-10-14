# Nimi Coding Host Integration

The Nimi workspace pins `@nimiplatform/nimi-coding@0.6.5` as an exact development dependency. Standard workspace installation sets up the CLI tools:

```bash
pnpm install
```

When executing CLI commands directly, run `pnpm exec nimicoding ...` from the repository root to ensure the workspace-local pinned package is invoked. Avoid relying on global `nimicoding` binaries in the system `PATH`.

## Verifying Integration Health

```bash
pnpm nimicoding:sync
pnpm nimicoding:doctor
```

- `pnpm nimicoding:sync`: Executes `sync --check` under the hood, validating synchronization of managed files without mutating product authority or host task state.
- `pnpm nimicoding:doctor`: Verifies runtime compatibility between the installed package version and managed specifications.

For newly created empty repositories, `nimicoding start` bootstraps basic templates and local scratch directories. Because the current Nimi repository is already fully configured, everyday development relies on the `sync` and `doctor` scripts above.

The managed blocks in `AGENTS.md` and `CLAUDE.md` define available tools and architectural boundaries for AI hosts; they are advisory guidelines rather than intrusive execution wrappers.

## Source Code Reads and Authority Markers

Version 0.6.5 provides two primary source inspection utilities:
- **`code context`**: Extracts bounded outbound static context from explicit TypeScript and TSX source files.
- **`code authority`**: Scans tracked TypeScript, TSX, Go, Python, and Rust files for explicit `@nimi-authority` and `@nimi-deprecated` marker lines. Marker discovery operates via exact line matching and does not evaluate unannotated code.

## Validating Product Authority

```bash
pnpm spec:authority:check
pnpm spec:authority:compile
pnpm spec:authority:audit
```

When modifying authority specifications, follow the workflow defined in `.nimi/methodology/authority-authoring.yaml`:
1. Retrieve bounded context before changes.
2. Execute semantic diff and impact evaluations within defined byte budgets.
3. Format changed containers using `authority fmt`.
4. Run `authority check` across the full `.nimi/spec` corpus.

## Configuration Layout

- **`.nimi/config/**`**: Houses configuration specific to Nimi Coding host execution.
- **`.nimi/methodology/**`**: Contains authoritative methodology documentation.
- **Root `config/**`**: Reserved for product-level schemas, generator inputs, and platform static maps; referencing a canonical authority ID does not turn a product file into an alternate authority source.

## Source Basis

- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
- [`.nimi/methodology/authority-authoring.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-authoring.yaml)
