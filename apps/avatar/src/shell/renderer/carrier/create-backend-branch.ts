// Authority: docs/authority/avatar-embodiment-rationale.md.
//
// THIS IS THE ONLY ALLOWED `model.kind` / `backend.kind` SWITCH SITE in
// `apps/avatar/src/**`. The static hard-cut grep gate
// (`kind_branch_outside_factory`) audits this — any new branch must be
// added here, must update both the discriminated `AvatarModelManifest`
// union and the `BackendBranch` union, and must keep the exhaustive
// `_exhaustive: never` check intact (per backend-branch-contract §3.1).

import type { AvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';
import type { BackendAudioConsumer, BackendBranch } from './backend-branch.js';
import { createLive2DBackendBranch } from '../live2d/live2d-backend-branch.js';
import { createNimi2DBackendBranch } from '../nimi2d/nimi2d-backend-branch.js';
import { createVrmBackendBranch } from '../vrm/vrm-backend.js';

// Branch-owned cue/signal handles used by carrier orchestration outside the
// BackendBranch projection. They stay explicit here so backend-specific
// wiring has one switch site.
export type BackendBranchHandle = {
  branch: BackendBranch;
  audioConsumer: BackendAudioConsumer;
  recordBootstrapVisualProof?: () => Promise<void>;
  shutdown(): void;
};

export async function createBackendBranch(
  manifest: AvatarModelManifest,
): Promise<BackendBranchHandle> {
  switch (manifest.kind) {
    case 'live2d': {
      const handle = await createLive2DBackendBranch(manifest);
      return {
        branch: handle.branch,
        audioConsumer: handle.audioConsumer,
        recordBootstrapVisualProof: handle.recordBootstrapVisualProof,
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
    case 'nimi2d': {
      return createNimi2DBackendBranch(manifest);
    }
    default: {
      // Exhaustive: any new BackendKind must update this switch (and the
      // BackendBranch union in backend-branch.ts) before typecheck passes.
      const _exhaustive: never = manifest;
      throw new Error(`unhandled backend kind in createBackendBranch: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
