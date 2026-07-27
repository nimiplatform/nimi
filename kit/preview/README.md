# Nimi Kit Preview

Source-linked workbench for inspecting Kit UI surfaces in the current
development environment.

## Run

```bash
pnpm kit:preview          # dev server on :1470 (source-linked to kit/ui/src)
```

The preview resolves `@nimiplatform/kit/ui` to kit **source** (not dist),
so edits to `kit/ui/src/**` are reflected immediately.

## URL controls

- `?scheme=light|dark` — foundation scheme
- `?density=regular|compact` — density axis (P-DESIGN-028)
- `?section=foundations|typography|actions|inputs|overlays|feedback` — single-section render
- `?overlay=dialog|drawer|popover` — force an overlay open on load
