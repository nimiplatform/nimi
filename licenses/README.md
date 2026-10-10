# License layout

Nimi-authored material uses the following component defaults:

- `runtime/`, `nimi-cognition/`, `sdks/typescript/`, `proto/`, `app-tools/`, `npm-packages/`: Apache-2.0
- `apps/`, `kit/`: MIT
- `app-tools/templates/default-starter/`, `app-tools/templates/app-source/`: MIT (override the `app-tools/` default)
- `docs/`, `.nimi/spec/`: CC BY 4.0

Published package roots carry a local `LICENSE`; the repository root [LICENSE](../LICENSE)
records the component map and third-party exceptions. These defaults do not
replace third-party file notices, dependency licenses or model-weight terms.

The [LocateAnything loader notice](../runtime/internal/engine/assets/locateanything_loader/NOTICE.md)
distinguishes its fixed GitHub code release, Hugging Face source provenance,
retained file notices and separately acquired model weights. Runtime also
retains Spotify Basic Pitch's license/NOTICE and Deezer Spleeter's MIT license
under `runtime/internal/engine/assets/`. Distribution notices must reflect the
actual embedded and linked third-party material, not only the package-root license.

Avatar's [Live2D Cubism Core notice](../apps/avatar/src/shell/renderer/public/assets/js/live2d-cubism-core/Core/LICENSE.md)
identifies its separate proprietary license. The App MIT default does not
cover Cubism Core or replace the Cubism SDK's framework and publication terms.
