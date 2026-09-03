# Desktop

Desktop is Nimi's own native app for your computer. It can do things
the browser version can't safely offer: a built-in Runtime, local AI,
real windows and menus, and workflows that need access to a real OS.

This section covers what you can do in Desktop, how Web mode differs,
and where each feature's data actually lives.

## What This Section Contains

- [Web Mode](/desktop/web-mode) — a smaller, browser-based way to use
  selected Desktop surfaces.

## Desktop And Web Are Different

Nimi runs on both Desktop and Web, but the two don't offer the same
capabilities. Web mode is a deliberately smaller experience. Desktop
carries the native and local features.

| Capability area | Desktop | Web |
| --- | --- | --- |
| Native runtime bootstrap | Available | Disabled |
| Local AI capability surfaces | Available when admitted | Disabled |
| Native window and shell behavior | Available | Disabled |
| Sensitive token persistence | Native-secure | Constrained |
| Public product reads (browse, chat, world view) | Available | Available when admitted as projection |

Keep this in mind when you choose where to run Nimi. A page that works
in the browser doesn't automatically come with the desktop-only
features behind it, even when the two look the same.

## What Desktop Owns

Desktop handles the shell itself: windows, menus, native bridging,
local integration, and the first-party workflows you use every day. It
builds on Runtime and SDK contracts rather than replacing them.

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

- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
- [`.nimi/spec/desktop/shell-runtime.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-runtime.authority.yaml)
- [`.nimi/spec/desktop/bridge-ipc.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/bridge-ipc.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
