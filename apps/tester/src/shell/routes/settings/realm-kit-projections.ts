import {
  resolveRuntimeAgentVoicePlaybackDecision,
  type RuntimeAgentPresentationLipsyncFrameBatchEvent,
  type RuntimeAgentPresentationVoicePlaybackRequestedEvent,
  type RuntimeAgentTimelineEnvelope,
} from '@nimiplatform/sdk/runtime';
import {
  isRealmFeedScope,
  projectRealmBaseUrl,
  projectRealmRealtimeUrl,
  REALM_FEED_SCOPES,
  resolveRealmMediaUrl,
} from '@nimiplatform/sdk/realm';
import { resolveAgentVoicePlaybackCue } from '@nimiplatform/kit/features/avatar/headless';
import {
  createRealmChatResourceAttachmentPayload,
  resolveRealmChatAttachmentPreviewText,
  resolveRealmChatMediaUrl,
} from '@nimiplatform/kit/features/chat/realm';

export function createTesterSettingsRealmKitProjections() {
  const realmMediaUrlProjection = resolveRealmMediaUrl({
    realmBaseUrl: 'https://realm.example/',
    mediaUrl: '/api/resources/images/tester-preview',
  }) ?? 'unavailable';
  const realmEndpointProjection = projectRealmBaseUrl({
    realmBaseUrl: 'http://127.0.0.1',
  });
  const realmRealtimeProjection = projectRealmRealtimeUrl({
    realmBaseUrl: 'http://127.0.0.1:3002/api',
  });
  const realmFeedScopeProjection = {
    count: REALM_FEED_SCOPES.length,
    agentActivityAdmitted: isRealmFeedScope('agent_activity'),
    localAgentActivityAdmitted: isRealmFeedScope('local_agent_activity'),
  };
  const realmChatAttachmentPayloadProjection = createRealmChatResourceAttachmentPayload('tester-resource-preview');
  const realmChatAttachmentProjection = {
    mediaUrl: resolveRealmChatMediaUrl({
      attachment: {
        displayKind: 'CARD',
        preview: {
          targetType: 'RESOURCE',
          targetId: 'tester-resource-preview',
          displayKind: 'IMAGE',
          url: '/resources/images/tester-chat-preview',
        },
      },
    }, 'https://realm.example/'),
    previewText: resolveRealmChatAttachmentPreviewText({
      attachment: {
        displayKind: 'CARD',
        preview: {
          displayKind: 'IMAGE',
        },
      },
    }),
    targetType: realmChatAttachmentPayloadProjection.attachment.targetType,
  };
  const avatarVoiceCueProjection = resolveAgentVoicePlaybackCue(
    new Uint8Array([128, 208, 232, 208, 128, 48, 24, 48]),
    0.24,
    new Uint8Array([230, 220, 188, 132, 84, 52, 24, 12]),
  );
  const runtimeAvatarVoiceProjection = (() => {
    const timeline = (
      channel: RuntimeAgentTimelineEnvelope['channel'],
      offsetMs: number,
    ): RuntimeAgentTimelineEnvelope => ({
      turnId: 'tester-turn',
      streamId: 'tester-stream',
      channel,
      offsetMs,
      sequence: channel === 'voice' ? 1 : 2,
      startedAtWall: '2026-05-31T00:00:00.000Z',
      observedAtWall: '2026-05-31T00:00:00.024Z',
      timebaseOwner: 'runtime',
      projectionRuleId: 'K-AGCORE-051',
      clockBasis: 'monotonic_with_wall_anchor',
      providerNeutral: true,
      appLocalAuthority: false,
    });
    const voiceEvent: RuntimeAgentPresentationVoicePlaybackRequestedEvent = {
      eventName: 'runtime.agent.presentation.voice_playback_requested',
      localAgentRef: 'local-agent:tester-owner:tester-agent',
      conversationAnchorId: 'tester-anchor',
      turnId: 'tester-turn',
      streamId: 'tester-stream',
      timeline: timeline('voice', 0),
      detail: {
        audioArtifactId: 'tester-audio',
        audioMimeType: 'audio/wav',
        playbackState: 'requested',
      },
    };
    const lipsyncEvent: RuntimeAgentPresentationLipsyncFrameBatchEvent = {
      eventName: 'runtime.agent.presentation.lipsync_frame_batch',
      localAgentRef: 'local-agent:tester-owner:tester-agent',
      conversationAnchorId: 'tester-anchor',
      turnId: 'tester-turn',
      streamId: 'tester-stream',
      timeline: timeline('lipsync', 0),
      detail: {
        audioArtifactId: 'tester-audio',
        frames: [
          { frameSequence: 1, offsetMs: 0, durationMs: 80, mouthOpenY: 0.2, audioLevel: 0.24 },
          { frameSequence: 2, offsetMs: 80, durationMs: 90, mouthOpenY: 0.7, audioLevel: 0.66 },
        ],
      },
    };
    const decision = resolveRuntimeAgentVoicePlaybackDecision({
      voiceEvent,
      lipsyncEvent,
      activeTurnId: 'tester-turn',
      activeStreamId: 'tester-stream',
    });
    return decision.kind === 'schedule'
      ? {
        kind: decision.kind,
        cueCount: decision.schedule.cueEnvelope.cues.length,
        source: decision.schedule.cueEnvelope.source,
      }
      : {
        kind: decision.kind,
        cueCount: 0,
        source: decision.kind === 'reject' ? decision.reason : decision.audioArtifactId,
      };
  })();
  return {
    realmMediaUrlProjection,
    realmEndpointProjection,
    realmRealtimeProjection,
    realmFeedScopeProjection,
    realmChatAttachmentProjection,
    avatarVoiceCueProjection,
    runtimeAvatarVoiceProjection,
  };
}

export type TesterSettingsRealmKitProjections = ReturnType<typeof createTesterSettingsRealmKitProjections>;
