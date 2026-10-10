# Profiles, Loadouts, and Execution

An AIProfile is a portable configuration package. Applying it produces editable prefill; it does not commit AIConfig, select a Loadout, install assets, or start execution.

## Three Separate Records

| Record | Purpose |
| --- | --- |
| AIProfile | Share portable choices and defaults without machine identities or secrets |
| AIConfig | Save one App owner's or the shared LocalAgent owner's complete capability intent and revision |
| Loadout | Save one machine-local capability implementation, Driver dialect and recipe, options, and exact resource bindings |

Runtime keeps zero or more Loadouts per capability and at most one current selection per capability. A Local AIConfig entry contains only the Local route marker; it does not copy that selected Loadout. A Cloud entry saves the exact Connector reference, CapabilityImplementation, and provider-model target.

## Prepare, Commit, Select

A machine configuration change uses its admitted Prepare and Commit flow with explicit confirmation. Installing a model only creates an inventory resource; binding the required resources into a Loadout and selecting that Loadout are distinct actions. Changing the machine selection affects future Local submissions for that capability across owners, so the UI must explain that scope.

Configuration validity, resource bindings, environment compatibility, current selection, process state, and actual execution are separate facts. A selected or prepared configuration is not proof of successful inference.

## Capture at Submission

At Job submission, Runtime checks the committed AIConfig and current authority. For Local it captures the selected Loadout and complete resolved assembly, including exact content identities. For Cloud it captures the committed Connector and implementation target under Runtime credential custody.

Queued, running, and resumed Jobs use those persisted inputs. They do not reread a changed AIConfig or machine selection, rank alternatives, probe for a better model, or silently fall back. Current authorization is still checked separately. Missing configuration or resources return typed failures.

An App sends content and supported operation parameters through its host-bound client. It does not attach a profile, Local Loadout, endpoint, credential, or request-time routing override. [AIConfig](/sdk/ai-config-surface) is the separate configuration API.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
