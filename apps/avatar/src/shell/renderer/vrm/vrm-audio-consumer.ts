// VRM BackendAudioConsumer wrapper.
//
// Backend-neutral wLipSync/WebAudio lifecycle lives in kit. VRM keeps only
// app/backend diagnostics and expression-preset mouth mapping in
// vrm-lipsync-driver.

import {
  createWLipSyncAudioConsumer,
  type WLipSyncAudioConsumerFactory,
} from '@nimiplatform/kit/features/avatar/headless';
import type { Profile } from 'wlipsync';
import type { BackendAudioConsumer } from '../carrier/backend-branch.js';

export type VrmAudioConsumerDeps = {
  /** wLipSync MFCC profile. When `null`, the consumer logs once and silents
   *  on attach; carrier-startup evidence reports `wlipsync_profile_missing`. */
  profile: Profile | null;
  /** Test seam for stubbing `createWLipSyncNode` without bundling worklets. */
  createNode?: WLipSyncAudioConsumerFactory;
  /** Sink the carrier surface tick reads from. */
  onSilent?: () => void;
};

export interface VrmAudioConsumer extends BackendAudioConsumer {
  /** Diagnostics + tests. */
  isAttached(): boolean;
}

export function createVrmAudioConsumer(deps: VrmAudioConsumerDeps): VrmAudioConsumer {
  return createWLipSyncAudioConsumer({
    profile: deps.profile,
    createNode: deps.createNode,
    onSilent: deps.onSilent,
    missingProfileMessage:
      '[avatar:vrm:lipsync] wlipsync profile missing — lipsync silent',
    createFailureMessage:
      '[avatar:vrm:lipsync] createWLipSyncNode failed; lipsync silent',
    connectFailureMessage:
      '[avatar:vrm:lipsync] source.connect(wlipsync) failed',
  });
}
