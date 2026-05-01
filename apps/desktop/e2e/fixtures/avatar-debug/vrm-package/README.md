# Desktop Avatar Debug VRM Package Fixture

This directory is the paired Agent Center package fixture for the real VRM
debug closeout path.

- Avatar asset: `files/VRM1_Constraint_Twist_Sample.vrm`
- Package manifest: `manifest.json`
- Source asset: pixiv `three-vrm` sample asset,
  `packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm`
- License: MIT, inherited from upstream `pixiv/three-vrm`

The manifest shape mirrors the Desktop Agent Center imported-package custody
format. It is evidence for the product chain only; Desktop still treats
`avatar_package_ref` as an opaque control-record reference and does not use this
fixture to widen Avatar launch payload.
