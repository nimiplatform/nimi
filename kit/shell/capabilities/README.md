# Shell Capabilities

`kit/shell/capabilities` is the standard contract surface for Nimi shell hosts.
It owns capability ids, operation ids, standard command names, and the standard
error envelope consumed by Tauri, Electron, and renderer bridge code.

The machine authority for this module is
`.nimi/spec/platform/kernel/tables/standard-shell-capabilities.yaml`.
Human guides, acceptance matrices, and gate descriptions may reference that
table, but they do not create a parallel source of truth.
