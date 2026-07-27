# Desktop

Desktop is Nimi's first-party native shell. It can host things the Web
version can't safely promise: native Runtime integration, local AI
capabilities, native window behavior, and workflows that
need access to a real OS.

This section walks through what Desktop covers, how Web differs from it,
and how native surfaces stay inside Runtime/SDK boundaries.

## What This Section Contains

- [Web Mode](/desktop/web-mode) — the constrained projection of selected
  Desktop surfaces in the browser.

## Desktop And Web Are Different

Nimi has both Desktop and Web surfaces, but they do not have the same
capability envelope. Web is a constrained projection. Desktop carries
native and local behavior when contracts admit it.

| Capability area | Desktop | Web |
| --- | --- | --- |
| Native runtime bootstrap | Available | Disabled |
| Local AI capability surfaces | Available when admitted | Disabled |
| Native window and shell behavior | Available | Disabled |
| Sensitive token persistence | Native-secure | Constrained |
| Public product reads (browse, chat, world view) | Available | Available when admitted as projection |

This distinction is important for public docs. A Web page should not
imply Desktop-native capability just because the product concepts are
shared. Code that is host-agnostic on the surface may still depend on a
Desktop-only contract underneath.

## What Desktop Owns

Desktop owns shell behavior, native bridging, window and menu behavior,
local integration boundaries, and first-party user workflows. It consumes
Runtime and SDK contracts rather than replacing them.

## Reader Scenario: A Surface That Is "Available On Both"

Suppose a public read surface (for example, browsing a world) is
admitted on both Desktop and Web. Even then:

- Desktop renders the surface inside the native shell with native
  navigation and (when admitted) local enhancement.
- Web renders the surface inside the browser without native bootstrap
  and without sensitive token persistence beyond
  what browsers can safely offer.

A reader who is making a distribution decision needs to understand that
"available on both" does not mean "identical on both."

## Source Basis

- [`docs/spec/desktop-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/desktop-domain-index.md)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
- [`.nimi/spec/desktop/shell-runtime.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-runtime.authority.yaml)
- [`.nimi/spec/desktop/bridge-ipc.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/bridge-ipc.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
