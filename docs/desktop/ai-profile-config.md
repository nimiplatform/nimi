# AI Configuration in Nimi Home

Use AI Capabilities to prepare local configurations, Cloud Services to manage cloud connections, and the relevant App or shared LocalAgent AI settings to choose how each capability executes.

## Choose the Configuration Owner

Each App has its own AIConfig. All LocalAgents in the current account share one LocalAgent AIConfig; selecting a different Agent does not create a new owner. Nimi Chat uses the Desktop App configuration, while Agent Chat uses the shared LocalAgent configuration.

For each capability, choose Local or Cloud and the required features and defaults. Local follows the machine's current Loadout for that capability. Cloud requires an exact current-account Connector and implementation target from Runtime's safe options. Credentials and endpoints are not AIConfig fields.

Saving replaces the complete capability list against its current revision. Preserve unchanged entries; omission clears an entry. Resolve a revision conflict before saving again. Saving does not require a successful inference probe and does not prove execution readiness.

## Prepare Local Capabilities

AI Capabilities contains Profile recommendations and sharing, the on-device model list, and the capability configuration workspace. A Loadout binds the implementation recipe and every required resource. Use the setup flow to prepare and commit it, then explicitly select the capability's default configuration.

The machine selection is shared by future Local requests for that capability. It is not a per-App or per-Agent model binding. Existing Jobs retain their captured execution inputs.

Model Library owns file inspection, import, storage, integrity, and removal. Downloads tracks existing App, model, and environment tasks. Shared components and configuration environments show their own diagnostics; they do not create another model selector.

## Apply a Profile

Applying a portable AIProfile fills an editor without committing owner or machine state. Review the prefill, resolve current-environment Cloud references or local resource requirements, and complete the relevant save or confirmation action. Profile provenance is descriptive, not a live binding.

See [Local AI](/desktop/local-ai) for installation and [Profiles and Execution](/runtime/ai-profile-execution) for submission behavior.

## Source Basis

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
