// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Pure presentational R3F scene for the VRM backend. No state, no effects;
// trusts that the loader has already applied frustumCulled=false on the
// scene graph (vrm-loader.ts step 5). The static lights are renderer-local and
// do not create backend-neutral or Runtime truth.

import type { VRM } from '@pixiv/three-vrm';
import type { JSX } from 'react';

export type VrmSceneProps = {
  vrm: VRM | null;
};

export function VrmScene({ vrm }: VrmSceneProps): JSX.Element {
  return (
    <>
      <ambientLight intensity={1.6} />
      <directionalLight position={[1, 1, 1]} intensity={1.4} />
      {vrm ? <primitive object={vrm.scene} /> : null}
    </>
  );
}
