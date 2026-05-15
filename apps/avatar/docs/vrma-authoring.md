# VRMA Motion Preset Authoring

> **Status**: Wave 0 admit (topic `2026-04-30-avatar-vrm-backend-branch`,
> design-04 §"VRM Motion Preset Registry" + design-08 §"资产源决策").
> **Owner**: avatar app authority.
> **Audience**: Internal asset author producing optional future built-in
> interchange `.vrma` presets.

This document is the canonical author pipeline for the `.vrma` motion preset
assets shipped under `apps/avatar/assets/vrm-motion-presets/`. It targets
asset authors using **Blender** (with **UniVRM** add-on) who need to produce
loop-safe, low-drift skeletal animation that loads via
`@pixiv/three-vrm-animation` `loadVrmAnimation`.

## Required Tooling

| Tool | Version | Purpose |
| --- | --- | --- |
| Blender | 4.x (LTS recommended) | Animation authoring |
| UniVRM Blender Add-on | 2.x | `.vrm` import + `.vrma` export menu |
| VRoid Studio (optional) | latest | Source character for rigging if not authoring from scratch |
| Reference VRM file | any admitted VRM sample | Exporter rig target (UniVRM exports `.vrma` against a humanoid skeleton) |

`@pixiv/three-vrm-animation` is **not** a Blender plugin — it is the runtime
loader. Authoring happens entirely in Blender; the runtime reads the
exported `.vrma` (a glTF binary with `VRMC_vrm_animation` extension).

## Current Built-In Preset

The current built-in interchange registry contains one physical preset:

| Preset id | Loop | Duration | Description |
| --- | --- | --- | --- |
| `idle_subtle` | yes | ~3 s | Subtle breathing + micro head sway; primary idle baseline |

Runtime generated motion routes (`listen_lean`, `nod_yes`, `shake_no`,
`greet_wave`) are governed by `generated-motion-routes.yaml` and
`generated-motion-provider-contract.md`; they are not required physical
`.vrma` assets.

## Author Pipeline (Blender)

1. **Import the reference VRM**
   - File → Import → VRM (UniVRM)
   - Select any admitted sample VRM (or a VRoid Studio export)
   - Confirm the humanoid armature shows under Scene Outliner

2. **Create a new Action**
   - Switch Workspace → Animation
   - Open the Dope Sheet → Action Editor
   - Click "New" to create a fresh Action; name it after the preset id
     (e.g. `idle_subtle`)

3. **Animate the humanoid bones**
   - Select bones from the imported VRM armature only
     (do NOT key non-humanoid bones; UniVRM exporter ignores them)
   - For loop presets (`idle_subtle`, `listen_lean`):
     - Set scene end frame = duration_sec × fps (24 fps default → 72 frames
       for 3 s)
     - Match first and last keyframe values exactly to ensure seamless loop
   - For non-loop presets (`nod_yes`, `shake_no`):
     - 1.2 s × 24 fps = 29 frames
     - Animate to natural rest pose at end (do NOT match start pose)

4. **Author guidelines**
   - Keep amplitudes subtle: idle breath = ±2°, head sway = ±3°
   - Avoid translation on Hips; rely on rotation only (translation interacts
     poorly with VRM root motion semantics)
   - Use Bezier interpolation (Graph Editor → smooth curves) for natural ease

5. **Export**
   - File → Export → VRM Animation (UniVRM `.vrma`)
   - Filename = `<preset_id>.vrma` (matches `vrm-motion-presets.yaml` `file:`
     field)
   - UniVRM serializes the active Action against the humanoid bone map

6. **Place the file**
   - Copy to `apps/avatar/assets/vrm-motion-presets/<preset_id>.vrma`
   - Verify file size > 0 and < 1 MB (typical preset is ~10–50 KB; > 1 MB
     suggests over-keyframing or accidental armature-wide keys)

7. **Verify load**
   - Run the wave_0 admission unit test (or a manual console check) that
     calls `loadVrmAnimation` against the new `.vrma`. The test must:
     - Successfully resolve the VRMAnimation object
     - Find at least 1 humanoid track
     - Decode without throwing
   - Failure → revisit step 3 (skeleton mismatch with UniVRM exporter
     expectations is the most common cause)

## Loop Closure Verification

For loop presets (`idle_subtle`, `listen_lean`), confirm seamless loop:

```
Frame 1 keyframe values == Frame N keyframe values   (where N = loop length)
```

Visual check: in Blender, scrub past frame N and let it wrap to frame 1.
There MUST be no visible jump. If a jump appears:

- Open the Graph Editor
- Select the offending channel (typically a head bone Z-rotation)
- Match the last keyframe value to the first keyframe value exactly
- Re-export

`@pixiv/three-vrm-animation` `loadVrmAnimation` returns the animation as a
`THREE.AnimationClip` with the loop flag respected by the `AnimationMixer`
configuration in the runtime. Author-side loop closure is the only way to
prevent visible discontinuities.

## License + Source Fields

Internal-author presets use:

```yaml
license: internal
source: apps/avatar/docs/vrma-authoring.md (Blender + UniVRM author)
```

(matches `vrm-motion-presets.yaml` exact strings; spec validator rejects
placeholder tokens like `TBD` / `candidate`).

For wave_3 external presets, lock both fields to concrete non-placeholder
values (specific SPDX id + URL) before admit. See design-08 §"资产源决策"
for the wave_3 admit checklist.

## Per-Model Override

Models that ship their own motion overrides at
`<model_path>/motions/<preset_id>.vrma` follow the same authoring steps but
are loaded by `vrm-motion-preset-registry.ts` from the model package, not
from `apps/avatar/assets/`. Override files MUST reference an admitted
preset id; unknown ids are rejected at registry load.

## Built-In Interchange Asset Gate

The current built-in interchange registry requires:

- `apps/avatar/assets/vrm-motion-presets/idle_subtle.vrma` physically exists
- `loadVrmAnimation` PASSes against it (unit or manual verify)

Topic `2026-05-15-avatar-vrm-deferral-and-authority-reconciliation` wave 2
hard-cuts the previous unbacked registry rows. `listen_lean`, `nod_yes`,
`shake_no`, and `greet_wave` are runtime generated-motion route ids, not
required built-in `.vrma` files. Future built-in interchange presets may use
this authoring process, but they must add real files, concrete license/source
metadata, tests, and topic evidence in the same admission packet.
