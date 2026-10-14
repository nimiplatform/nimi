# Local Environment Information and Installation Progress

Nimi Home needs to show where a model download stands, whether dependency work has finished, and when the user needs to confirm the next step. The SDK local environment client brings Runtime’s results to the host UI, preserving identities, ordering, and failure details so the interface does not have to guess.

## Who Can Use It

`createNimiRuntimeLocalEnvironmentClient` in `@nimiplatform/sdk/runtime` serves hosts and system integrations with the required access. The ordinary App `NimiLocalAppClient` has no general environment installation or management surface. Importing a type or constructing a direct client does not grant that access.

Apps should use their existing host-bound AI configuration and call results, guiding users to prepare resources in Nimi Home. Do not create a parallel platform model installer or infer platform state by scanning files, Python environments, or engine ports.

## What a Host Can Present

- Runtime-provided model assets, integrity results, and download or dependency-job progress.
- Environment installation plans, explicit confirmation requirements, and admitted cancellation, retry, and repair actions.
- Environment plans and revision conditions for saved candidate Loadouts; reread returned state when a conflict occurs.

These projections do not establish model selection, AIConfig routing, Loadout selection, execution binding, or capability admission. A downloaded file alone is not evidence that an inference request will succeed.

## Keep the Integration Boundary Clear

Use public exports and their typed clients. Do not import `runtime/internal/**`, `kit/internal/**`, or another App’s business code. Show failed installation, unknown state, and unavailable resources as distinct outcomes rather than turning them into a “ready” result.

## Source Basis

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
