# Web Mode

Web mode is a constrained projection of Nimi. It can present selected
platform and product surfaces in the browser, but it does not inherit
Desktop-native runtime, local, mod, window, or shell capabilities.

The kernel rules behind Web behavior live under the Web release
contract and the Desktop web adapter.

## What Is Disabled In Web

The Web adapter disables surfaces that depend on Desktop or Tauri-like
capabilities:

- Native runtime bootstrap.
- Mod registration and the in-process hook runtime.
- External-agent bridges that depend on native processes.
- Native window management and OS integrations.
- Sensitive token persistence beyond what browsers can safely offer.

These constraints are not arbitrary. Each one corresponds to a contract
that the browser cannot satisfy without weakening user safety or
content integrity.

## What Web Can Still Do

Web can present admitted surfaces that are safe in a constrained
projection:

- Explain the platform, route users through public docs, and host
  browser-safe product surfaces when those surfaces are admitted.
- Surface read-oriented experiences whose contracts have been admitted
  as web-safe.
- Provide entry points back into the Desktop shell for users who need
  full capability.

The Web role is to be a real surface, but a deliberately smaller one
than Desktop.

## Reader Scenario: A Capability Available Only On Desktop

Suppose a user follows a public link to a Nimi page in a browser, and
the page references a feature that depends on a native runtime
capability. The Web adapter does not silently fall back to a degraded
version. The expected behavior under the contract is:

- The browser surface explains that the feature requires Desktop.
- Native bootstrap is not implied.
- The user is not led to believe the browser is running the feature.

This honesty matters. A silent fallback would lie about the actual
posture of the system.

## Reader Scenario: A Mod Author Wondering About Web

Suppose a mod author wants their mod to run on Web "for reach." Under
the Web adapter, mods are not part of the Web surface. The author has
two real options:

- Build a Desktop mod and accept that the surface is Desktop only.
- Propose a non-mod surface (for example, a content read pattern) that
  could be admitted as a web-safe projection.

Web mode does not become a smaller mod runtime by accident. If a
capability is admitted for Web, that is an explicit contract change.

## Source Basis

- [`.nimi/spec/desktop/web-adapter.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/web-adapter.md)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`.nimi/spec/desktop/kernel/ui-shell-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/ui-shell-contract.md)
- [`.nimi/spec/desktop/kernel/bootstrap-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/bootstrap-contract.md)
