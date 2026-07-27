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
| Nimi Coding | Managed `.nimi/{config,contracts,methodology}` projections, spec-construction methodology, surface taxonomy and placement contracts, four-closure and role-separation methodology, deterministic spec/AI governance validation | Host task lifecycle, planning, delegation, implementation, review or completion state; provider/runtime orchestration; product authority under `.nimi/spec/**` |

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

- [`docs/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/INDEX.md)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/authority-admission.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/authority-admission.authority.yaml)
- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
- [`docs/spec/runtime-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/runtime-domain-index.md)
- [`docs/spec/sdks-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/sdks-domain-index.md)
- [`docs/spec/desktop-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/desktop-domain-index.md)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/avatar-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/avatar-domain-index.md)
- [`docs/spec/cognition-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/cognition-domain-index.md)
