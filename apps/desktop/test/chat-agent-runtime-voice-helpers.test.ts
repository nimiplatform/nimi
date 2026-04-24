import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveMediaUrlFromArtifact,
  resolveVoicePlaybackCueEnvelopeFromArtifact,
} from '../src/shell/renderer/features/chat/chat-agent-runtime-voice-helpers.js';

test('voice playback cue envelope resolver admits nested provider metadata scopes', () => {
  const envelope = resolveVoicePlaybackCueEnvelopeFromArtifact({
    metadata: {
      speech: {
        mouthCues: [
          {
            start: 0,
            end: 120,
            value: 'AA',
            viseme: 'aa',
            amplitude: 0.31,
          },
          {
            start: 120,
            end: 240,
            phoneme: 'oh',
            weight: 0.66,
          },
        ],
      },
    },
  });

  assert.deepEqual(envelope, {
    version: 'v1',
    source: 'provider',
    cues: [
      {
        offsetMs: 0,
        durationMs: 120,
        amplitude: 0.31,
        visemeId: 'aa',
      },
      {
        offsetMs: 120,
        durationMs: 120,
        amplitude: 0.66,
        visemeId: 'oh',
      },
    ],
  });
});

test('voice playback cue envelope resolver prefers admitted nested envelope over alignment fallback', () => {
  const envelope = resolveVoicePlaybackCueEnvelopeFromArtifact({
    speechAlignment: {
      tokens: [
        {
          token: 'a',
          startMs: '0',
          endMs: '100',
        },
      ],
    },
    metadata: {
      timing: {
        playbackCueEnvelope: {
          version: 'v1',
          source: 'provider',
          cues: [
            {
              offsetMs: 12,
              durationMs: 140,
              amplitude: 0.52,
              visemeId: 'ee',
            },
          ],
        },
      },
    },
  });

  assert.deepEqual(envelope, {
    version: 'v1',
    source: 'provider',
    cues: [
      {
        offsetMs: 12,
        durationMs: 140,
        amplitude: 0.52,
        visemeId: 'ee',
      },
    ],
  });
});

test('voice media artifact resolver fails closed when playback mime is missing', () => {
  assert.throws(() => resolveMediaUrlFromArtifact({
    artifact: {
      artifactId: 'voice-artifact-missing-mime',
      uri: 'file:///tmp/voice-missing-mime.mp3',
    },
    missingArtifactMessage: 'agent voice synthesis returned no artifacts',
    missingMediaMessage: 'agent voice synthesis artifact has no uri or bytes',
    actionHint: 'retry_voice_synthesis',
  }), /missing a legal audio mime type/);
});

test('voice media artifact resolver fails closed when playback mime is not audio', () => {
  assert.throws(() => resolveMediaUrlFromArtifact({
    artifact: {
      artifactId: 'voice-artifact-text-mime',
      mimeType: 'text/plain',
      uri: 'file:///tmp/voice-text.txt',
    },
    missingArtifactMessage: 'agent voice synthesis returned no artifacts',
    missingMediaMessage: 'agent voice synthesis artifact has no uri or bytes',
    actionHint: 'retry_voice_synthesis',
  }), /missing a legal audio mime type/);
});
