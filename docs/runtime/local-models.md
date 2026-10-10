# Local Models and Loadouts

A model file is an inventory resource. A Loadout is a saved capability configuration with an exact implementation recipe and resource bindings. Runtime's machine store keeps at most one selected Loadout per capability; that selection supplies future requests whose owner has saved Local intent.

## Prepare a Local Capability

1. In Nimi Home's AI Capabilities workspace, inspect the capability and Runtime-issued setup options.
2. Acquire the required model assets. Model Library owns file import, storage, verification, and removal; Downloads displays existing transfer and setup tasks.
3. Prepare and commit the Loadout with the required model slots, content identities, options, and environment resources.
4. Explicitly select it as that capability's machine default. This affects future Local submissions across App and shared LocalAgent owners.
5. Save Local intent for the capability in the relevant AIConfig, then make an actual request through its protected client.

Installation alone does not bind or select a Loadout. An asset with no matching recipe can remain in the inventory without becoming executable. Companion resources do not become standalone capability models merely because a recipe uses them.

## Interpret Status Correctly

| Fact | What it establishes |
| --- | --- |
| File verification | Stored bytes match the asset's registered content identity |
| Resource bindings | A particular Loadout names its required resources |
| Configuration/environment checks | That exact configuration's preparation facts and typed blockers |
| Current selection | The machine default for future Local submissions of one capability |
| Successful execution | The specific request completed successfully |

These facts are not interchangeable. Unchecked or failed environment inspection remains unknown or failed; it does not prove prepared state or a missing component. Read status per configuration, not as one merged readiness grade for a model.

Runtime provides catalog compatibility and recommendation evidence. Consumers preserve Runtime ordering and do not infer compatibility from filenames, model names, tags, or process health.

## Execution

At submission, Runtime validates the selected Loadout and atomically captures a complete resolved assembly with exact resource identities. Queued, running, and resumed Jobs retain that capture. Runtime does not search installed inventory, rerank models, switch selections, or fall back when a required input is missing.

The App request contains content and supported parameters. Its Local AIConfig contains no Loadout or model selector. Safe effective-selection output helps explain configuration; it is not request-side control.

## Environment and Process Ownership

Runtime owns admitted dependency materialization, progress, cancellation, cleanup, and execution-host supervision. Home displays the typed operations. Public Start or Warm Model actions and App-driven process polling are not part of capability execution.

An environment can be prepared while a Job later fails. A process can be stopped while Runtime can start it for an admitted Job. Use the actual operation result rather than deriving execution truth from process state.

## Source Basis

- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
