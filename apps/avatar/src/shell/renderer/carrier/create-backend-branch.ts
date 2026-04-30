// Wave 1 of topic 2026-04-30-avatar-vrm-backend-branch (design-02
// §"createBackendBranch").
//
// THIS IS THE ONLY ALLOWED `model.kind` / `backend.kind` SWITCH SITE in
// `apps/avatar/src/**`. The packet hard-cut grep gate
// (`kind_branch_outside_factory`) audits this — any new branch must be
// added here, must update both the discriminated `AvatarModelManifest`
// union and the `BackendBranch` union, and must keep the exhaustive
// `_exhaustive: never` check intact (per backend-branch-contract §3.1).

import type { AvatarModelManifest } from './model-resolver.js';
import type { BackendAudioConsumer, BackendBranch } from './backend-branch.js';
import type { Live2DBackendSession } from '../live2d/backend-session.js';
import type { Live2DCommandBus } from '../live2d/plugin-api.js';
import type { EmbodimentProjectionApi } from '../nas/embodiment-projection-api.js';
import { createLive2DBackendBranch } from '../live2d/live2d-backend-branch.js';
import { createVrmBackendBranch } from '../vrm/vrm-backend.js';

// Wave_1 transitional handle shape. All fields outside `branch` /
// `audioConsumer` / `shutdown` are scoped to the carrier's transitional
// wiring (NAS event dispatch, embodiment-stage `visualSession` prop) and
// are `null` for backends that do not yet expose them. Later wave_1 steps
// remove these slots once consumers move to `backend.surface` /
// `backend.projection`.
export type BackendBranchHandle = {
  branch: BackendBranch;
  audioConsumer: BackendAudioConsumer;
  shutdown(): void;
  commandBus: Live2DCommandBus | null;
  backendSession: Live2DBackendSession | null;
  legacyProjection: EmbodimentProjectionApi | null;
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
        shutdown: handle.shutdown,
        commandBus: handle.commandBus,
        backendSession: handle.backendSession,
        legacyProjection: handle.legacyProjection,
      };
    }
    case 'vrm': {
      const handle = await createVrmBackendBranch(manifest);
      return {
        branch: handle.branch,
        audioConsumer: handle.audioConsumer,
        shutdown: handle.shutdown,
        commandBus: null,
        backendSession: null,
        legacyProjection: null,
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
