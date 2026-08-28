import assert from 'node:assert/strict';
import test from 'node:test';

import { projectDesktopRuntimePresentationProfile } from '../src/shell/renderer/features/chat/chat-agent-shell-adapter-runtime.js';

test('Desktop preserves the complete canonical presentation profile projection', () => {
  assert.deepEqual(projectDesktopRuntimePresentationProfile({
    status: 'ready',
    presentationRevision: '7',
    backendKind: 'vrm',
    avatarAssetRef: 'avatar:current',
    expressionProfileRef: 'expression:current',
    idlePreset: 'idle:current',
    interactionPolicyRef: 'interaction:current',
    defaultVoiceReference: 'preset_voice_id:serena',
    avatarAutoplay: true,
    backgroundRef: 'background:current',
  }), {
    backendKind: 'vrm',
    avatarAssetRef: 'avatar:current',
    expressionProfileRef: 'expression:current',
    idlePreset: 'idle:current',
    interactionPolicyRef: 'interaction:current',
    defaultVoiceReference: 'preset_voice_id:serena',
    avatarAutoplay: true,
    backgroundAssetRef: 'background:current',
  });
});
