import {
  isNimiRealmFeedScope,
  NIMI_REALM_FEED_SCOPES,
  projectNimiRealmBaseUrl,
  projectNimiRealmRealtimeUrl,
  resolveNimiRealmMediaUrl,
} from '@nimiplatform/sdk/realm';
import { resolveAgentVoicePlaybackCue } from '@nimiplatform/kit/features/avatar/headless';
import { resolveAvatarLive2dFramingPolicy } from '@nimiplatform/kit/features/avatar/live2d';
import { resolveAvatarVrmFramingPolicy } from '@nimiplatform/kit/features/avatar/vrm';
import {
  createRealmChatResourceAttachmentPayload,
  resolveRealmChatAttachmentPreviewText,
  resolveRealmChatMediaUrl,
} from '@nimiplatform/kit/features/chat/realm';

export function createTesterSettingsRealmKitProjections() {
  const realmMediaUrlProjection = resolveNimiRealmMediaUrl({
    realmBaseUrl: 'https://realm.example/',
    mediaUrl: '/api/resources/images/tester-preview',
  }) ?? 'unavailable';
  const realmEndpointProjection = projectNimiRealmBaseUrl({
    realmBaseUrl: 'http://127.0.0.1',
  });
  const realmRealtimeProjection = projectNimiRealmRealtimeUrl({
    realmBaseUrl: 'http://127.0.0.1:3002/api',
  });
  const realmFeedScopeProjection = {
    count: NIMI_REALM_FEED_SCOPES.length,
    agentActivityAdmitted: isNimiRealmFeedScope('agent_activity'),
    localAgentActivityAdmitted: isNimiRealmFeedScope('local_agent_activity'),
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
    targetType: String((realmChatAttachmentPayloadProjection as { attachment?: { targetType?: string } }).attachment?.targetType ?? 'none'),
  };
  const avatarVoiceCueProjection = resolveAgentVoicePlaybackCue(
    new Uint8Array([128, 208, 232, 208, 128, 48, 24, 48]),
    0.24,
    new Uint8Array([230, 220, 188, 132, 84, 52, 24, 12]),
  );
  const avatarFramingProjection = {
    vrm: resolveAvatarVrmFramingPolicy({
      railWidth: 320,
      railHeight: 820,
      metrics: {
        width: 0.9,
        height: 1.8,
        depth: 0.75,
        minX: -0.45,
        minY: -0.9,
        minZ: -0.375,
        maxX: 0.45,
        maxY: 0.9,
        maxZ: 0.375,
        centerX: 0,
        centerY: 0,
        centerZ: 0,
        silhouetteAspect: 2,
        widthRatio: 0.5,
      },
      intent: 'head-shoulders',
    }).mode,
    live2d: resolveAvatarLive2dFramingPolicy({
      railWidth: 920,
      railHeight: 360,
      modelCanvasWidth: 1,
      modelCanvasHeight: 1.42,
      layout: new Map(),
      intent: 'bottom-companion',
    }).mode,
  };
  const runtimeAvatarVoiceProjection = (() => {
    return {
      kind: 'unavailable',
      cueCount: 0,
      source: 'runtime_agent_voice_playback_decision_not_public_in_sdk_vnext',
    };
  })();
  return {
    realmMediaUrlProjection,
    realmEndpointProjection,
    realmRealtimeProjection,
    realmFeedScopeProjection,
    realmChatAttachmentProjection,
    avatarVoiceCueProjection,
    avatarFramingProjection,
    runtimeAvatarVoiceProjection,
  };
}

export type TesterSettingsRealmKitProjections = ReturnType<typeof createTesterSettingsRealmKitProjections>;
