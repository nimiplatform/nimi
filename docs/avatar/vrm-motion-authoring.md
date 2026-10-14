# VRMA Interchange Animations

`.vrma` files support animation authoring, asset interchange, and offline inspection. In the current Avatar product runtime, live activity and idle motions are driven by the generated-motion runtime; the engine does not scan a model's motions directory to automatically replace idle motions.

## Authoring and Interchange

Prepare an animation clip tailored to the target VRM humanoid skeleton and export it in a VRM Animation format supported by the current loader. Verify bone mappings, facial expressions, loop boundaries, and retargeting results. Follow the exporter's documentation for tool-specific settings.

The repository's VRMA preset registry provides an independent interchange pipeline. It loads the preset table and can receive an explicit `perModelOverrides` list from the caller. A matching preset ID overrides the existing preset entry; an unrecognized ID does not register a new product route.

## Model-Specific Interchange Clip

1. Author and export an animation clip matching the target skeleton.
2. In a tool that integrates the interchange registry, explicitly supply the asset reference for a known preset ID.
3. Call the registry's `loadAll` method with the target VRM and `perModelOverrides`, then inspect the loading and retargeting results.
4. Verify the motion loop and target posture through that tool's actual playback pipeline.

Simply placing an `idle_subtle.vrma` file into a model directory will not change product idle behavior. Product route support is determined by the generated-motion catalog, model capability profiles, and safety constraints—not the mere presence of animation files.

## Current Product Motion

To test or verify product routes such as `nod_yes`, `greet_wave`, or `idle_subtle`, follow the current [Generated Motion and Sidecar](/avatar/generated-motion-provider) pipeline and verify the results in the real Avatar window.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`config/avatar-vrm-motion-presets.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-vrm-motion-presets.yaml)
- [`config/avatar-generated-motion-routes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-generated-motion-routes.yaml)
- [`apps/avatar/src/shell/renderer/vrm/vrm-motion-preset-registry.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-motion-preset-registry.ts)
- [`apps/avatar/src/shell/renderer/vrm/vrm-backend.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-backend.tsx)
- [`apps/avatar/src/shell/renderer/vrm/vrm-projection-adapter.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-projection-adapter.ts)
