// Live2D BackendAudioConsumer wrapper.
//
// Backend-neutral wLipSync/WebAudio resource ownership lives in Kit. Live2D keeps only
// app/backend diagnostics and Cubism mouth mapping in live2d-lipsync-driver.

import {
  createWLipSyncAudioConsumer,
  type WLipSyncAudioConsumerFactory,
} from '@nimiplatform/kit/features/avatar/headless';
import type { Profile } from 'wlipsync';
import type { BackendAudioConsumer } from '@nimiplatform/kit/features/avatar/headless';

export type Live2DAudioConsumerDeps = {
  /** wLipSync MFCC profile. When `null`, the consumer logs once and silents
   *  on attach; carrier-startup evidence reports `wlipsync_profile_missing`. */
  profile: Profile | null;
  /** Test seam for stubbing `createWLipSyncNode` without bundling worklets. */
  createNode?: WLipSyncAudioConsumerFactory;
  /** Sink the carrier surface tick reads from. */
  onSilent?: () => void;
};

export function createLive2DAudioConsumer(
  deps: Live2DAudioConsumerDeps,
): BackendAudioConsumer {
  return createWLipSyncAudioConsumer({
    profile: deps.profile,
    createNode: deps.createNode,
    onSilent: deps.onSilent,
    missingProfileMessage:
      '[avatar:live2d:lipsync] wlipsync profile missing — lipsync silent',
    createFailureMessage:
      '[avatar:live2d:lipsync] createWLipSyncNode failed; lipsync silent',
    connectFailureMessage:
      '[avatar:live2d:lipsync] source.connect(wlipsync) failed',
  });
}
