# Local AI in Nimi Home

Open **AI Capabilities** to prepare and select local capability configurations. Its home combines Profile recommendations and sharing with the models on this device. The capability workspace shows saved configurations, their resources, preparation state, and the current default.

## Where to Act

| Surface | Task |
| --- | --- |
| AI Capabilities | Configure a capability and explicitly select its machine default |
| Model Library | Inspect, import, verify, remove, and manage storage for model files |
| Configuration environment | Inspect the environment required by one saved configuration |
| Shared components | Inspect machine-shared components through their owner operations |
| Downloads | Follow App, model, and environment tasks already created |
| Cloud Services | Manage cloud connections separately |

## From Model to First Request

Install or import the required assets, configure the implementation recipe and all required resources into a Loadout, and explicitly select it for the capability. Then save Local intent in the App's AI settings and run an actual request. For Agent Chat, the intent belongs to the account's shared LocalAgent configuration.

The selected Loadout is a machine default for that capability, so changing it affects future Local submissions from other owners too. Existing Jobs keep their submitted execution inputs.

## What the Status Means

File verification means registered bytes match. A configuration's preparation status combines that configuration's resources and environment checks. The default label identifies current selection. None of these labels proves that a request has executed successfully.

Models with several variants or configurations keep those distinctions. A missing recipe match is shown as unidentified use; a companion resource is not described as independently performing the capability. An unchecked environment remains unchecked.

Runtime supplies compatibility, recommendations, progress, and failures. Home does not rank replacements or select an alternative when a Job fails. Dependencies install through Runtime's admitted materializer, with explicit progress and failure, rather than arbitrary shell commands in the renderer.

For exact configuration and execution semantics, see [Local Models and Loadouts](/runtime/local-models).

## Source Basis

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
