// Wave 2 chunk 2-C of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Pure presentational R3F scene for the VRM backend. No state, no effects;
// trusts that the loader has already applied frustumCulled=false on the
// scene graph (vrm-loader.ts step 5). Lights match
// vrm-backend-contract.md §9 Scene Hierarchy: ambient 0.6 + directional
// 0.8 from front-top-right. The light intensities/positions are static
// per AGENTS.md §"VRM Backend Pitfalls" #10 (no per-frame light writes).

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
