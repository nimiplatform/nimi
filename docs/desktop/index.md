# Desktop

Desktop is Nimi's first-party native shell. It can host things the Web
version can't safely promise: native Runtime integration, local AI
capabilities, the mod system, native window behavior, and workflows that
need access to a real OS.

This section walks through what Desktop covers, how Web differs from it,
and how Desktop mods are governed.

## What This Section Contains

- [Web Mode](/desktop/web-mode) — the constrained projection of selected
  Desktop surfaces in the browser.
- [Mods](/desktop/mod-system) — Desktop's bounded extension model and the hook
  capability boundary.

## Desktop And Web Are Different

Nimi has both Desktop and Web surfaces, but they do not have the same
capability envelope. Web is a constrained projection. Desktop carries
native and local behavior when contracts admit it.

| Capability area | Desktop | Web |
| --- | --- | --- |
| Native runtime bootstrap | Available | Disabled |
| Local AI capability surfaces | Available when admitted | Disabled |
| Mod registration and runtime | Available | Disabled |
| Native window and shell behavior | Available | Disabled |
| Sensitive token persistence | Native-secure | Constrained |
| Public product reads (browse, chat, world view) | Available | Available when admitted as projection |

This distinction is important for public docs. A Web page should not
imply Desktop-native capability just because the product concepts are
shared. Code that is host-agnostic on the surface may still depend on a
Desktop-only contract underneath.

## What Desktop Owns

Desktop owns shell behavior, native bridging, mod governance surfaces,
window and menu behavior, local integration boundaries, and first-party
user workflows. It consumes Runtime and SDK contracts rather than
replacing them.

## Reader Scenario: Installing A Mod That Uses A Local Capability

Suppose a Desktop user wants to install a mod that uses a local AI
capability:

1. The user goes through Desktop's mod governance surface. Mods have a
   defined lifecycle (admitted, installed, active, suspended) under the
   mod-governance contract.
2. The mod declares which hook capabilities it needs. Each hook
   capability comes from an allowlisted set; arbitrary capabilities are
   not granted.
3. The mod consumes runtime capabilities via `sdk/mod` and the Desktop
   hook surface. It doesn't bypass Runtime contracts, even though it
   is running locally.
4. If the device profile or local capability registry does not admit
   the requested local route, the mod gets a typed denial, not a
   silent fallback.

The same flow on Web simply does not happen. The Web adapter disables
native runtime bootstrap and mod registration; the same mod cannot run
unmodified in the browser.

## Reader Scenario: A Surface That Is "Available On Both"

Suppose a public read surface (for example, browsing a world) is
admitted on both Desktop and Web. Even then:

- Desktop renders the surface inside the native shell with native
  navigation and (when admitted) local enhancement.
- Web renders the surface inside the browser without native bootstrap,
  without mod surfaces, and without sensitive token persistence beyond
  what browsers can safely offer.

A reader who is making a distribution decision needs to understand that
"available on both" does not mean "identical on both."

## Source Basis

- [`.nimi/spec/desktop/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/index.md)
- [`.nimi/spec/desktop/kernel/ui-shell-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/ui-shell-contract.md)
- [`.nimi/spec/desktop/kernel/mod-governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/mod-governance-contract.md)
- [`.nimi/spec/desktop/kernel/hook-capability-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/hook-capability-contract.md)
- [`.nimi/spec/desktop/kernel/bootstrap-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/bootstrap-contract.md)
- [`.nimi/spec/desktop/kernel/bridge-ipc-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/bridge-ipc-contract.md)
- [`.nimi/spec/desktop/web-adapter.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/web-adapter.md)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml)
- [`.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml)
