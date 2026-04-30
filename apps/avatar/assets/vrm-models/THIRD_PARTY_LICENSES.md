# Third-Party Licenses — VRM Models

Binaries are NOT committed to the repository. They are fetched on demand
to `apps/avatar/.cache/assets/vrm-models/` via
`apps/avatar/scripts/fetch-vrm-models.mjs`.

The fetcher's algorithm is mirrored from the desktop helper
`apps/desktop/scripts/run-macos-smoke-helpers.mjs::ensureVrmSample` but
re-implemented locally so that `apps/avatar` remains self-contained
(no cross-app imports; enforced by `pnpm check:apps-avatar-isolation`).

## VRM1_Constraint_Twist_Sample.vrm

- **Source**: <https://github.com/pixiv/three-vrm/blob/release/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm>
- **Raw URL**: <https://raw.githubusercontent.com/pixiv/three-vrm/release/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm>
- **Upstream project**: pixiv/three-vrm
- **License**: MIT (same as the `@pixiv/three-vrm` npm package this repo
  depends on for VRM runtime)
- **Original copyright**: `Copyright (c) 2019-PRESENT pixiv Inc.`
- **Admitted under**: Wave 2 of topic
  `2026-04-30-avatar-vrm-backend-branch` (Option C-prime — MIT
  fork-copy spirit). The literal airi VRM models cannot be fork-copied
  because the airi repository gitignores
  `**/assets/vrm/models/*`; pixiv/three-vrm is the canonical MIT
  upstream that airi itself references for these constraint-twist demo
  assets.
- **Cache target**:
  `apps/avatar/.cache/assets/vrm-models/VRM1_Constraint_Twist_Sample.vrm`
  (gitignored; fetched on demand)

```
MIT License

Copyright (c) 2019-PRESENT pixiv Inc.

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

Full upstream LICENSE: <https://github.com/pixiv/three-vrm/blob/release/LICENSE>.
