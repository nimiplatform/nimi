# Third-Party Licenses — VRM Motion Presets

This directory contains `.vrma` motion preset assets shipped with
`@nimiplatform/avatar`. Some assets are forked from third-party MIT-licensed
sources; their attributions are recorded below.

## idle_subtle.vrma

- **Source**: `_external/airi/packages/stage-ui-three/src/assets/vrm/animations/idle_loop.vrma`
- **Upstream project**: [airi](https://github.com/moeru-ai/airi)
- **License**: MIT
- **Original copyright**: `Copyright (c) 2024-PRESENT Neko Ayaka`
- **Admitted under**: Wave 0 of topic `2026-04-30-avatar-vrm-backend-branch`
  (Option C-prime — airi MIT fork-copy; design-11 reference admit covers
  this path)
- **Notes**: airi's authored `idle_loop.vrma` substitutes for the originally
  planned in-house `idle_subtle.vrma` to land the wave_0 PoC. wave_3 may
  re-author this asset internally per `docs/avatar/vrm-motion-authoring.md`
  if a different idle authoring is desired; the registry id stays
  `idle_subtle` to preserve activity-mapping references.

```
MIT License

Copyright (c) 2024-PRESENT Neko Ayaka

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
```

Full upstream LICENSE: `_external/airi/LICENSE`.
