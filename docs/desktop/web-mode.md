# Web Mode

Web mode is a constrained projection of Nimi. It can present selected
platform and product surfaces in the browser, but it does not inherit
Desktop-native runtime, local, window, or shell capabilities.

The kernel rules behind Web behavior live under the Web release
contract and the Desktop web adapter.

## What Is Disabled In Web

The Web adapter disables surfaces that depend on Desktop or Tauri-like
capabilities:

- Native runtime bootstrap.
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

## Source Basis

- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
- [`.nimi/spec/desktop/shell-runtime.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-runtime.authority.yaml)
