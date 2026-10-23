# Nimi OS · Field — Ecosystem Simulator Prototype 2

Status: **product-layer aesthetic study, non-authoritative**. It is not admitted, wired to real App renderers, or connected to a State Engine.

This design experiment remains available through the explicit commands below. Root
`build:all`, its pre-release checks, and CI workspace builds exclude this package.

Variant 2 explores an alternative shell language inspired by the Aurora spatial-OS concept (based on the reference video and `github.com/sxuff/aurora`, unlicensed — **design language re-implemented from scratch, no code copied**). Instead of a traditional desktop, it presents:

- A luminous gradient *field*
- Smoked-glass draggable *panes*
- A bottom *spine* dock
- A `⌘K` *Lens* command palette
- A *Tide* overview zoom
- Four atmosphere phases: day, dusk, night, and dawn

## Run

```bash
pnpm install
pnpm --filter @nimi-prototype/os-field dev     # http://localhost:5200
pnpm --filter @nimi-prototype/os-field build
```

## Controls

- **Wake screen**: Click anywhere to enter.
- **`⌘K` / `Ctrl+K`**: Open the Lens (command palette).
- **`` ` ``**: Toggle the Tide (overview zoom).
- **`◐` in the spine**: Cycle atmosphere phases (**auto** (follows time of day) → day → dusk → night → dawn).
- **Drag & flick**: Every pane and app window is draggable and flickable—release with velocity to coast, or hold still before releasing for a stationary drop.
- **Left app rail**: Acts as both launcher and running-instance switcher. Minimizing a window sends it back to its rail icon; click the icon to restore it.
- **Right-click empty field**: Opens the spatial menu (整理场 tidy, Lens, Tide, phase, cradle). Press `Esc` to close the active overlay or exit Tide.

## What it demonstrates

- **Spatial shell**: A cradle home arranged as a pane constellation, plus three simulated modules (Desktop / 织羽 Zhiyu / Lab).
- **LocalAgent continuity**: A Runtime LocalAgent projection (Nimi) with aurora accents and pre-seeded continuity.
- **Cross-app flows**: The three canonical cross-app flows—data sharing, intent handoff, and Runtime-mediated LocalAgent context projection.
- **Governance & ledger**: System-level consent, revocable grants returning typed `SIMULATOR_UNSUPPORTED` results, and a floating interaction-ledger pane.
- **Deterministic simulation**: Deterministic IDs, a logical clock, and explicit simulation disclosure on the wake screen.

The engine, scenarios, flows, module content, and spatial shell are all self-contained within this package. Glass material tiers, theme tokens, and accessibility downgrades consume the governed `@nimiplatform/kit` UI surface.

## Explicit non-goals

- No real App, Runtime, Realm, or SDK behavior, accounts, or side effects.
- No persistence (continuity uses pre-seeded scenario data), no environment variable ingestion, and no network calls.
- No production authority: nothing in this package amends `.nimi/spec/**`.
