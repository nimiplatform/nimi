# Runtime Configuration Contract

Runtime configuration and product-level control are strictly separated across distinct planes:

- `~/.nimi/nimi.json` is the definitive Product Control record that declares the authoritative `dataRoot.path`.
- System-protected locations (e.g., `%ProgramData%\Nimi\Runtime\Protected` on Windows) store internal credentials, session states, and verification proofs.
- Runtime strictly respects the storage roots established by Product Control, ensuring consistency and safety across all platform surfaces.

## Production Data Directory Structure

In standard production environments, all critical local assets reside under the declared `dataRoot`:

```text
<dataRoot>/models         # Local model weights and GGUF files
<dataRoot>/dependencies   # Inference engine libraries and hardware accelerators
<dataRoot>/environments   # Execution sandboxes and virtual environments
<dataRoot>/apps           # Installed Nimi App packages
<dataRoot>/accounts       # Local user accounts and authenticated sessions
<dataRoot>/logs           # Rotating daemon logs
<dataRoot>/audit          # Local security audit ledger (SQLite)
```

This centralized organization prevents random disk pollution and simplifies backup and storage management.

## Nonproduction Portable Mode

For automated testing or isolated developer sandboxing, developers can supply a custom configuration via the `NIMI_RUNTIME_CONFIG_PATH` environment variable:
- **Strict Validation**: The target configuration must conform strictly to the active schema.
- **Credential Protection**: Portable files manage non-sensitive test parameters and port assignments; provider credentials remain safeguarded in protected local storage.

## Atomic Writes and Controlled Reloading

- **Atomic File Writes**: Configuration mutations write to temporary buffers and rename atomically to prevent corruption during unexpected shutdowns.
- **Controlled Application**: Configuration parameters are loaded at startup; modifications take effect upon daemon restart.

## Source Basis

- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
