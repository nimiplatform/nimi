# VRM Motion Authoring

VRM motion in Avatar has two separate paths:

- Runtime motion proof comes from the generated motion provider,
  capability profiles, mapping sidecars, and supported backend routes.
- `.vrma` files are authoring and interchange assets. They can be
  loaded as motion presets, but their existence does not prove that a
  package supports runtime-driven motion.

This distinction matters for authors. A `.vrma` file is useful when
you want a portable skeletal animation preset. It is not a substitute
for the runtime provider path that turns Agent activity into live
backend output.

## When To Author `.vrma`

Use `.vrma` when you need:

- a built-in interchange preset under
  `apps/avatar/assets/vrm-motion-presets/`;
- a per-model override at `<model_path>/motions/<preset_id>.vrma`;
- a reference animation that can be loaded by
  `@pixiv/three-vrm-animation`;
- a loop-safe idle, breathing, or short gesture clip for inspection or
  interchange.

Do not use `.vrma` to claim APML or runtime activity support. Runtime
support is proven through generated motion provider evidence.

## Tooling

| Tool | Purpose |
| --- | --- |
| Blender 4.x | Author skeletal animation. |
| UniVRM Blender add-on 2.x | Import `.vrm` and export `.vrma`. |
| Reference VRM file | Provides the humanoid skeleton target. |
| `@pixiv/three-vrm-animation` | Runtime loader used by Avatar. |

`@pixiv/three-vrm-animation` is not a Blender plug-in. Authoring
happens in Blender. Avatar loads the exported `.vrma` as a glTF binary
with the `VRMC_vrm_animation` extension.

## Built-In Preset Registry

The current built-in interchange registry admits one physical preset:

| Preset id | File | Loop | Use |
| --- | --- | --- | --- |
| `idle_subtle` | `idle_subtle.vrma` | yes | Subtle idle motion baseline. |

Other motion route ids such as `listen_lean`, `nod_yes`, `shake_no`,
and `greet_wave` are generated-motion routes. They do not require
built-in `.vrma` files.

## Blender Pipeline

1. **Import a reference VRM.** Use UniVRM's VRM import path and confirm
   the humanoid armature appears in the scene.
2. **Create an Action.** In the Animation workspace, open the Action
   Editor and create an action named after the preset id.
3. **Animate humanoid bones only.** UniVRM exports animation against
   the humanoid skeleton. Avoid non-humanoid helper bones unless the
   exporter explicitly supports the target use.
4. **Avoid root drift.** Keep hips translation minimal. Prefer subtle
   rotation for breathing, leaning, nodding, and looking.
5. **Close loops exactly.** For looping clips, first and last keyframes
   must match on every animated channel.
6. **Export `.vrma`.** Use UniVRM's VRM Animation export path. The file
   name must match the registry `file` field.
7. **Place the asset.** Built-in presets go under
   `apps/avatar/assets/vrm-motion-presets/`. Per-model overrides go
   under `<model_path>/motions/`.
8. **Verify loading.** The asset must load through
   `loadVrmAnimation` and retarget through `clipFromVRMAnimation`.

## Loop Closure

Looping presets should scrub cleanly in Blender before export. If the
pose jumps when the timeline wraps:

1. Open the Graph Editor.
2. Find the channel that changed between the first and last frame.
3. Copy the first-frame value to the last frame.
4. Re-export and test again.

Small drift is visible on a desktop companion because the Avatar window
is transparent and the body becomes the user's focus.

## Registry And License Requirements

Every built-in `.vrma` registry entry needs:

- a real file under `apps/avatar/assets/vrm-motion-presets/`;
- a stable preset id;
- concrete license and source metadata;
- attribution when the asset is based on third-party work;
- tests or manual evidence showing the file loads through Avatar's VRM
  animation loader.

Placeholder values such as `TBD` or `candidate` are not acceptable in
the registry.

## Per-Model Overrides

A VRM package may include:

```text
<model_path>/motions/<preset_id>.vrma
```

The `preset_id` must already exist in the admitted registry. Unknown
override ids are rejected by the registry loader. This keeps package
overrides aligned with Avatar's motion ontology instead of letting each
model invent incompatible local names.

## Reader Scenario: Adding A New Idle Variant

An author wants a softer idle motion for a VRM character.

1. They author `idle_subtle` against the character's humanoid skeleton.
2. They export `idle_subtle.vrma`.
3. They place it at `<model_path>/motions/idle_subtle.vrma`.
4. Avatar detects the per-model override and uses it for interchange
   playback.
5. Runtime activity support still comes from the generated motion
   provider. The override does not become runtime proof by itself.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`config/avatar-vrm-motion-presets.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-vrm-motion-presets.yaml)
- [`config/avatar-generated-motion-routes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-generated-motion-routes.yaml)
- [`apps/avatar/assets/vrm-motion-presets/THIRD_PARTY_LICENSES.md`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/assets/vrm-motion-presets/THIRD_PARTY_LICENSES.md)
- [`apps/avatar/src/shell/renderer/vrm/vrm-motion-preset-registry.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-motion-preset-registry.ts)
