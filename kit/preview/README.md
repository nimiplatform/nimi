# Nimi Kit Preview

Source-linked workbench for governed UI surfaces, built for the
AI/agent audit → modify → accept loop.

## Run

```bash
pnpm kit:preview          # dev server on :1470 (source-linked to kit/ui/src)
pnpm check:kit-visual-audit   # headless build + screenshot matrix + assertions
```

The preview resolves `@nimiplatform/kit/ui` to kit **source** (not dist),
so edits to `kit/ui/src/**` are reflected immediately.

## URL contract (deterministic audit targets)

- `?scheme=light|dark` — foundation scheme
- `?density=regular|compact` — density axis (P-DESIGN-028)
- `?section=foundations|typography|actions|inputs|overlays|feedback` — single-section render
- `?overlay=dialog|drawer|popover` — force an overlay open on load

## Automated audit

`kit/preview/audit/run-audit.mjs`:

1. Builds the preview and serves it headlessly.
2. Captures the `scheme × density × section` screenshot matrix plus
   interaction-state shots (pressed, focus, overlay open).
3. Enforces machine-readable assertions on the **rendered** result —
   pressed feedback scale, continuous spring overlay travel (enter and
   symmetric exit), density sizing axis, typography tracking/CJK/hero
   execution, glass `saturate()` vibrancy, dead-animation-class
   elimination, rendered contrast, motion TS↔spec mirror sync, and a
   ratcheting hardcoded-visual-value scan (`audit/baseline.json` only
   decreases).
4. Writes screenshots + `report.json` + `report.md` to
   `.nimi/local/design-audit/kit-preview-<date>/` and exits non-zero on
   failure.

Token-level gates (`check:ui-contrast-matrix`, `check:ui-glass-boundary`,
`check:nimi-design-artifacts`) prove tokens are coherent. This gate
proves the **composed UI** is coherent. Audit output is local evidence
under `.nimi/local/**`, never product authority.
