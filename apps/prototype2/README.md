# Nimi OS · Field — Ecosystem Simulator Prototype 2

Status: **product-layer aesthetic study, non-authoritative**. It is not admitted,
wired to real App renderers, or connected to a State Engine.

Variant 2 studies a different shell language, after the Aurora spatial-OS
concept (reference video + `github.com/sxuff/aurora`, unlicensed — **design
language re-implemented, no code copied**): a luminous gradient *field*
instead of a desktop, smoked-glass draggable *panes*, a bottom *spine* dock,
a ⌘K *Lens*, a *Tide* overview, and day/dusk/night/dawn atmosphere phases.

## Run

```bash
pnpm install
pnpm --filter @nimi-prototype/os-field dev     # http://localhost:5200
pnpm --filter @nimi-prototype/os-field build
```

## Controls

- Wake screen: click anywhere to enter.
- `⌘K` / `Ctrl+K`: the Lens (command palette).
- `` ` ``: the Tide (overview zoom).
- `◐` in the spine: cycle atmosphere phase (**auto** (follows time of day) →
  day → dusk → night → dawn).
- Every pane and app window is draggable — and flickable: release with speed
  to coast; holding still before release produces no flick.
- The left **app rail** is both launcher and running-instance switcher. Minimize
  a window and it flies back to its rail icon; click the icon to restore it.
- Right-click an empty part of the field: spatial menu (整理场 tidy, Lens,
  Tide, phase, cradle). `Esc` closes the active overlay or exits Tide.

## What it demonstrates

The study covers a cradle home as a pane constellation, base agent (Nimi)
with aurora accents and pre-seeded memory, three simulated
modules (Desktop / 织语 Zhiyu / Tester), the three canonical cross-app flows
(data sharing, intent handoff, agent-mediated context carry), system-level
consent, revocable grants with typed `SIMULATOR_UNSUPPORTED` results, the
interaction ledger as a floating pane, deterministic ids/logical clock, and
simulation disclosure on the wake screen.

Engine, scenario, flows, module content, and the spatial shell are self-contained
under this package. Glass material tiers, theme tokens, and accessibility
downgrades consume the governed `@nimiplatform/kit` UI surface.

## Explicit non-goals

- No real App/Runtime/Realm/SDK behavior, accounts, or effects.
- No persistence (continuity is pre-seeded scenario data), no env ingestion,
  no network calls.
- No production authority: nothing here amends `.nimi/spec/**`.
