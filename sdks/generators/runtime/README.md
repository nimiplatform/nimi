# Runtime Generator

Runtime core manifests are generated from `proto/runtime/v1/*.proto`.
Typed public facades are hand-authored under `sdks/typescript/runtime/**` and
verified by their nearest owner tests; the core generator only projects the
Runtime wire contract.
