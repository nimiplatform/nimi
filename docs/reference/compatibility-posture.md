# Compatibility and Version Changes

Use a matching Runtime, SDK, Kit, and native carrier combination. A TypeScript API compiling against one SDK does not prove that an older host or native package carries the same contract.

## Current Development

These guides describe the current checkout. During prerelease development, superseded internal interfaces are removed instead of preserved through hidden shims, dual paths, or automatic startup migration. Where old local test data needs disposal, use the specific owner or one-time repair procedure; do not delete unrelated user state.

Current development packages may be supplied as complete local archives. Keep their declared versions and use explicit package-manager overrides, then run the App's synchronization, installation, and checks. See [Development Setup](/start/install).

## Published Components

Published packages and release tags are immutable. A breaking public change needs its component's version and upgrade instructions; internal prerelease hard-cut rules do not erase already published obligations. SDK, Kit, App Tools, and shell components release independently.

## Contract Failures

Malformed input, unsupported operation combinations, missing authorization, or invalid returned data fail closed with typed errors. Retry and reconnect do not repair contract violations, guarantee generation replay, or authorize resubmission after an uncertain external outcome.

For asynchronous recovery, retain and observe the original Job and its complete result. For a newer capability, update the matching carrier set instead of adding private transport or provider calls.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
