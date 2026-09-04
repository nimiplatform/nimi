# Web Mode

Web mode brings selected Nimi surfaces to the browser. It doesn't
include the desktop-only pieces: the native runtime, local
capabilities, native windows, or shell integrations.

Under the hood, what Web can and can't do is set by the Web release
contract and the Desktop web adapter.

## What Is Disabled In Web

The Web adapter turns off surfaces that depend on Desktop or
Tauri-like capabilities:

- Native runtime bootstrap.
- External-agent bridges that depend on native processes.
- Native window management and OS integrations.
- Sensitive token persistence beyond what browsers can safely offer.

These limits aren't arbitrary. Each one exists because a browser can't
meet the same bar for user safety or content integrity.

## What Web Can Still Do

Web still works well for what's safe in a constrained browser
environment:

- Introduce the platform, guide you through the public docs, and host
  product surfaces that are cleared for browser use.
- Offer read-oriented experiences that are confirmed web-safe.
- Point you back to the Desktop app when you need full capability.

Web is a real Nimi surface — just a deliberately smaller one than
Desktop.

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
