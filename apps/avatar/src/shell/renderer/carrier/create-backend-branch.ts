// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// This is the Avatar-owned branch selection site required by
// rule.nimi.avatar.embodiment.r002. The manifest and BackendBranch unions plus
// the exhaustive `never` check keep the closed live2d | vrm contract.

import type {
  AvatarModelManifest,
  BackendAudioConsumer,
} from '@nimiplatform/kit/features/avatar/headless';
import type { BackendBranch } from './backend-branch.js';
import { createLive2DBackendBranch } from '../live2d/live2d-backend-branch.js';
import { createVrmBackendBranch } from '../vrm/vrm-backend.js';

// Branch-owned cue/signal handles used by carrier orchestration outside the
// BackendBranch projection. They stay explicit here so backend-specific
// wiring has one switch site.
export type BackendBranchHandle = {
  branch: BackendBranch;
  audioConsumer: BackendAudioConsumer;
  shutdown(): void;
};

// @nimi-authority: rule.nimi.avatar.embodiment.r002
export async function createBackendBranch(
  manifest: AvatarModelManifest,
): Promise<BackendBranchHandle> {
  switch (manifest.kind) {
    case 'live2d': {
      const handle = await createLive2DBackendBranch(manifest);
      return {
        branch: handle.branch,
        audioConsumer: handle.audioConsumer,
        shutdown: handle.shutdown,
      };
    }
    case 'vrm': {
      const handle = await createVrmBackendBranch(manifest);
      return {
        branch: handle.branch,
        audioConsumer: handle.audioConsumer,
        shutdown: handle.shutdown,
      };
    }
    default: {
      // Exhaustive: any new BackendKind must update this switch (and the
      // BackendBranch union in backend-branch.ts) before typecheck passes.
      const _exhaustive: never = manifest;
      throw new Error(`unhandled backend kind in createBackendBranch: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
