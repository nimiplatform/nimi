# Availability and Capability Limits

Check the exact capability, implementation, package combination, and execution mode before depending on a feature. A provider name, catalog entry, successful build, or visible window alone does not establish that your request is supported.

## Common Misunderstandings

| Assumption | What to check instead |
| --- | --- |
| A model is installed, so AI is ready | The selected Loadout, required resources and environment, owner AIConfig, access, and actual execution |
| A Cloud connection supports every operation | Runtime-issued capability and feature options for the exact target |
| A Job event says completed, so all output was saved | Complete terminal Get, formal result reads, and App-owned result adoption |
| Local import means Catalog approval | Local import and Registry admission have separate source and trust rules |
| A package version exists in the checkout, so it can be installed publicly | The actual component publication; use complete local packages during development |
| Switching Apps or devices automatically shares every memory | The same authorized LocalAgent and Conversation, with Cognition's Agent-private Memory boundary |
| Local-first means no account or network requirements | The current account, protected session, source acquisition, and operation requirements |

A typed unavailable, blocked, or failed result is meaningful. Do not turn it into a sample success, silently switch implementations, or bypass the protected host. See [Compatibility](/reference/compatibility-posture), [App setup](/start/install), and [Job observation](/runtime/streaming).

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
