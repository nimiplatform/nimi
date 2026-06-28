# Runtime Config

> Status: Running today. The runtime config contract
> (`K-CFG-001..K-CFG-011`) governs canonical config path, source
> priority, schema versioning, secret policy, and reload boundaries.

The runtime reads configuration from a single canonical path with
explicit source priority. Config validation fails closed; reload
boundaries are explicit. There is no implicit hot-reload.

## Canonical Config Path

| Rule | Value |
| --- | --- |
| Canonical path | `~/.nimi/runtime/config.json` |
| Override | `NIMI_RUNTIME_CONFIG_PATH` |
| Ignored old path | `~/.nimi/config.json` is NOT read |

The runtime does not consult the old config location. Migrating
machines must move config to the canonical path or set
`NIMI_RUNTIME_CONFIG_PATH` explicitly for a managed environment.

## Source Priority

Sources resolve in fixed priority order:

```
environment variables  >  config file  >  built-in defaults
```

Environment variables override config file values. Config file values
override built-in defaults.

## Schema Version

| Rule | Value |
| --- | --- |
| Required field | `schemaVersion` |
| Current version | `1` |
| Unknown fields | Forward-compatible ignore |

A config without `schemaVersion` does not load. The forward-compat
posture lets older runtimes ignore newer fields without crashing.

## Provider Name Canonicalization

Provider names in config must use the canonical values from
`provider-catalog.yaml`. Aliases and retired provider names are **rejected**.
This prevents the situation where two configs spell the same provider
two different ways and silently route to different paths.

## Secret Policy

| Rule | Value |
| --- | --- |
| Per provider, choose one | `apiKey` or `apiKeyEnv` |
| Both set | Rejected |
| Recommended | Environment variable or system secure store |
| `apiKey` inline | Allowed only as canonical config file fallback |

User-facing tooling should prefer environment variables or secure
storage. Inline `apiKey` survives in the canonical config file as a
fallback because some onboarding flows require the value persist
across daemon restart, but the recommendation pushes toward
`apiKeyEnv` and secure storage.

## Atomic Write

Config writes use **temp-file + rename** atomic write. A crashed
write does not leave a half-written config; either the new config
landed atomically or the old one is still in place.

## Runtime Command Surface

`config init / validate / get / set` behavior must match this
contract. Errors emit unified reason codes; partial-success returns
are not admitted.

## Validation Fail-Close

| Rule | Value |
| --- | --- |
| Validation failure | Fail-close — runtime does NOT start core paths |
| Partial success | NOT admitted |

A config with one invalid field does not partially work with the
valid fields. The runtime refuses to start core execution paths
until config validates clean.

## Provider Env Binding

The mapping from provider to its `baseUrl` / `apiKey` environment
variable names lives in `provider-probe-targets.yaml`. The config
contract does not inline this mapping.

## Hot Reload Boundaries (K-CFG-010)

The most important rule on this page:

> Config changes that take effect at runtime versus only on restart
> **must be explicitly declared**. Implicit hot-reload is not
> admitted.

A config field is either documented as hot-reloadable or it is not.
Behavior that depends on whether something hot-reloaded "works
sometimes" is the error mode this rule prevents.

## Credential Plane Boundary (K-CFG-011)

The config layer admits credential references and admits an inline
secret fallback in the canonical config file. Higher-level install
and configuration entry points must prefer env / secure-store paths.

For public CLI first-run, if interactive credential capture happens,
the user-pasted provider key must immediately write to the canonical
machine config. The same onboarding `run` cannot succeed using only
a "this-call-only inline memory credential." The path must:

1. Warn about inline secret risk
2. Continue to recommend `apiKeyEnv` / secure-store
3. Fail closed if write fails — no continuation with cloud generation

The current invocation may continue with inline metadata to the
already-running daemon (avoiding the assumption that the daemon
hot-reloaded), but the **persisted truth** is the canonical config.

## Reader Scenario: Initial Config

1. **User runs `config init`.** Runtime writes a fresh `~/.nimi/runtime/config.json`
   with `schemaVersion: 1` and built-in defaults.
2. **User sets a provider.** `config set` writes provider entry with
   canonical name from `provider-catalog.yaml`.
3. **User adds API key.** Tooling prompts for `apiKeyEnv` first; if
   the user insists on inline, the value is stored under `apiKey`
   with a recommendation to switch to env.
4. **User starts daemon.** Validation runs; passes; daemon enters
   service.

## Reader Scenario: A Validation Failure At Boot

1. **Daemon starts.** Reads `~/.nimi/runtime/config.json`.
2. **Validation fails.** Provider name is a retired alias.
3. **Fail-close.** Daemon refuses to enter service. Reason code
   pinpoints the problem.
4. **User fixes.** Updates provider name to canonical; re-runs
   `config validate`; restarts daemon.

The daemon does not "partially start with the bad provider disabled."

## Reader Scenario: A Hot-Reload Question

A user changes a config field and asks: does this take effect now?

1. **Check the field's documented reload boundary.** If it is
   documented hot-reloadable, the runtime applies it; subscribed
   subsystems re-read.
2. **If documented restart-only,** the user must restart the
   daemon for the change to take effect.
3. **If not explicitly declared,** the field is **not** assumed
   hot-reloadable — the contract requires explicit declaration.

This rule is what makes config behavior predictable across upgrades.

## What Runtime Config Does Not Do

- It does not read retired config paths.
- It does not accept provider aliases or retired provider names.
- It does not permit both `apiKey` and `apiKeyEnv` for a single
  provider.
- It does not partially start when validation fails.
- It does not implicitly hot-reload arbitrary fields.

## Source Basis

- [`.nimi/spec/runtime/kernel/config-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/config-contract.md)
- [`.nimi/spec/runtime/kernel/key-source-routing.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/key-source-routing.md)
