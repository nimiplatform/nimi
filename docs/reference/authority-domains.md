# Authority Domains

Reference table for what each Nimi authority domain owns and does
not own.

## Domains

| Domain | Owns | Does not own |
| --- | --- | --- |
| Platform | World model, six protocol primitives, authority rules, app slice admission, AI last-mile action boundary, AI agent security interface | World truth; AI execution; app integration; UI rendering |
| Runtime | AI execution (text/image/video/audio/embedding/STT/TTS), workflows, streaming, multimodal artifacts, local capability routing, GPU arbitration, model lifecycle, agent execution (Chat Track / Life Track / Runtime HookIntent scheduling), runtime-local memory, knowledge banks, app-to-app messaging, delegated capability gateway, output firewall, local audit | World truth; SDK projection; UI; Cognition authority; Realm authority |
| SDK | App-facing access surface, surface contracts, transport, error projection, import boundaries | Runtime / Realm / Cognition / Desktop internals; new platform truth; runtime execution |
| Desktop | Native first-party shell, native bridging, window/menu behavior, local integration boundaries, first-party user workflows, External Agent Access placement | Runtime execution; SDK contract definition; Realm truth; Avatar embodiment authority; External Agent action authority |
| Web | Constrained browser projection of admitted Desktop surfaces | Native runtime bootstrap; native window; sensitive token persistence beyond browser-safe limits |
| Realm | World truth, world state, world history, chat, social, economy, asset, transit, binding, resource, bundle | Runtime execution; SDK projection; Desktop UI decisions; Cognition memory authority |
| Avatar | Embodied agent presentation, embodiment projection, carrier visual acceptance, backend branches (Live2D / VRM / generated motion), agent script, avatar event surface | Agent identity (Runtime); agent memory (Cognition); world truth (Realm); generation (Runtime) |
| Cognition | Standalone memory, knowledge, prompt serving, references, completion gates, skill service, runtime bridge contract, runtime upgrade contract | Runtime execution; Realm truth; Avatar embodiment; Desktop UI |
| Nimi Coding | Project truth projections, preflight methodology, four-closure framework, review separation, authority-convergence policy, forbidden-shortcuts catalog, deterministic gates, evidence contracts, declared skills | Task planning or progress; subagent coordination; retry or resume; Runtime execution; product code; AI host implementation; provider invocation |

## Cross-Domain Relationships

| Edge | Direction | Carries |
| --- | --- | --- |
| `desktop → nimi-sdk` | unidirectional | Unified developer surface |
| `desktop → nimi-runtime` | unidirectional | gRPC runtime access |
| `nimi-apps → Realm public API boundary` | unidirectional | REST + WS realm access |
| `nimi-runtime ↔ nimi-cognition` | bidirectional bridge | Runtime consumes cognition; cognition retains authority |
| `nimi-runtime ↔ Realm public API boundary` | sibling | Neither depends on the other; SDK bridges them |

## Boundary Rules

| Boundary | Rule |
| --- | --- |
| Apps must use SDK | Apps cannot import private Runtime / Realm internals; SDK is the boundary |
| SDK does not redefine | SDK projects upstream contracts; does not invent new product truth |
| Runtime cannot absorb Cognition | Bridge contract is consumption; authority remains with Cognition |
| Cognition cannot redefine Realm | Memory and knowledge are not world truth |
| Web cannot imply Desktop-native | Web adapter disables capabilities the browser cannot honor |
| Avatar cannot redefine agent | Presentation is downstream of identity |

## Authorization Presets

| Preset | Read | Write | Delegate |
| --- | --- | --- | --- |
| `readOnly` | yes | no | no |
| `full` | yes | yes | no |
| `delegate` | yes | yes | one level |

## App Modes

| Mode | Read | Write | Active count per world |
| --- | --- | --- | --- |
| `render-app` | yes | no | many |
| `extension-app` | yes | yes | at most one active |

## Source Basis

- [`.nimi/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/INDEX.md)
- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
- [`.nimi/spec/platform/kernel/app-slice-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/app-slice-admission-contract.md)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
- [`.nimi/spec/platform/kernel/governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/governance-contract.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/sdks/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/index.md)
- [`.nimi/spec/desktop/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/index.md)
- [`.nimi/spec/desktop/web-adapter.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/web-adapter.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/avatar/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/index.md)
- [`.nimi/spec/cognition/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/index.md)
