---
layout: home

hero:
  name: Nimi
  text: Open-Source AI Runtime
  tagline: "Rapid Development Phase — One runtime for local and cloud AI. Use it, build with it, or extend it."
  actions:
    - theme: brand
      text: Start Using Nimi
      link: /user/
    - theme: alt
      text: Build An App
      link: /app-dev/
    - theme: alt
      text: Build A Mod
      link: /mod-dev/
    - theme: alt
      text: GitHub
      link: https://github.com/nimiplatform/nimi

features:
  - title: Install And Run
    details: Install Nimi, start the runtime, generate with local or cloud models from the CLI. No code needed.
    link: /user/install
    linkText: Get started
  - title: Local And Cloud, Same Surface
    details: Local defaults to bundled models. Cloud uses --provider or --cloud. Same commands, same runtime.
    link: /user/providers
    linkText: Set up providers
  - title: SDK For Apps
    details: "Recommended app entry: createPlatformClient() from '@nimiplatform/sdk', with typed runtime and realm access from one root package."
    link: /app-dev/
    linkText: Start building
  - title: Nimi Coding
    details: AI-readable source-of-truth governance plus the formal execution system overview for contracts, validators, CLI, and execution workflows.
    link: /nimi-coding
    linkText: Learn the system
---

::: warning Rapid Development Phase
Nimi is still in an extremely fast-moving stage. Contracts, CLI flows, and desktop surfaces can change quickly between releases.

Treat the [Spec Map](/architecture/spec-map) and [`spec/` on GitHub](https://github.com/nimiplatform/nimi/tree/main/spec) as the normative source of truth. Items under `spec/future/` are backlog, not release promises.
:::
