# VRMA Interchange Animations

.vrma files support animation authoring, interchange, and offline inspection. Current Avatar product activity and idle use the generated-motion runtime; they do not scan a model motions directory to replace idle automatically.

## Authoring and Interchange

Prepare an animation matching the target VRM humanoid skeleton and export a VRM Animation format supported by the current loader. Check bones, expressions, loop boundaries, and retargeting. Follow the exporter documentation for tool-specific controls.

The repository's VRMA preset registry is a separate interchange path. It loads the preset table and may receive an explicit perModelOverrides list from its caller. A matching preset ID shadows the existing entry; an unknown ID does not create a product route.

## Model-Specific Interchange Clip

1. Author and export a clip for the target skeleton.
2. In a tool using the interchange registry, explicitly supply its asset reference for a known preset ID.
3. Call the registry's loadAll with the target VRM and perModelOverrides, then inspect loading and retargeting results.
4. Check the loop and target posture through that tool's actual playback path.

Placing idle_subtle.vrma in a model directory alone does not change product idle. Product route support still comes from the generated-motion catalog, capability profile, and safety limits, not file presence.

## Current Product Motion

For product routes such as nod_yes, greet_wave, and idle_subtle, use the current [Generated Motion and Sidecar](/avatar/generated-motion-provider) path and verify the result in the real Avatar window.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`config/avatar-vrm-motion-presets.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-vrm-motion-presets.yaml)
- [`config/avatar-generated-motion-routes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-generated-motion-routes.yaml)
- [`apps/avatar/src/shell/renderer/vrm/vrm-motion-preset-registry.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-motion-preset-registry.ts)
- [`apps/avatar/src/shell/renderer/vrm/vrm-backend.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-backend.tsx)
- [`apps/avatar/src/shell/renderer/vrm/vrm-projection-adapter.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-projection-adapter.ts)
