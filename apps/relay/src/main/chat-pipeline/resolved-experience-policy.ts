import type {
  DerivedInteractionProfile,
  InteractionSnapshot,
  LocalChatContextPacket,
  VoiceConversationMode,
} from './types.js';
import type { LocalChatDefaultSettings, LocalChatInspectSettings } from '../settings/types.js';

export type ResolvedExperiencePolicy = {
  deliveryPolicy: {
    style: LocalChatDefaultSettings['deliveryStyle'];
    allowMultiReply: boolean;
  };
  voicePolicy: {
    enabled: boolean;
    autonomy: LocalChatDefaultSettings['voiceAutonomy'];
    conversationMode: VoiceConversationMode;
    autoPlayReplies: boolean;
    selectedVoiceId: string | null;
    selectionMode: 'auto' | 'manual';
  };
  mediaPolicy: {
    autonomy: LocalChatDefaultSettings['mediaAutonomy'];
    visualComfortLevel: LocalChatDefaultSettings['visualComfortLevel'];
    routeSource: 'local' | 'cloud';
    nsfwPolicy: 'disabled' | 'local-only' | 'allowed';
    allowVisualAuto: boolean;
    allowAutoVisualHighRisk: boolean;
  };
  contentBoundary: {
    relationshipBoundaryPreset: LocalChatDefaultSettings['relationshipBoundaryPreset'];
    visualComfortLevel: LocalChatDefaultSettings['visualComfortLevel'];
    routeSource: 'local' | 'cloud';
    relationshipState: InteractionSnapshot['relationshipState'] | 'new';
  };
  inspectFlags: Pick<LocalChatInspectSettings, 'diagnosticsVisible' | 'runtimeInspectorVisible'>;
};

function resolveRouteSource(value: unknown): 'local' | 'cloud' {
  return value === 'cloud' ? 'cloud' : 'local';
}

function resolveVoiceConversationMode(input: {
  requestedMode?: VoiceConversationMode;
  settings: LocalChatDefaultSettings;
}): VoiceConversationMode {
  if (!input.settings.enableVoice) {
    return 'off';
  }
  if (input.requestedMode === 'on') {
    return input.requestedMode;
  }
  if (input.settings.voiceConversationMode === 'on') {
    return input.settings.voiceConversationMode;
  }
  return 'off';
}

function resolveNsfwPolicy(input: {
  routeSource: 'local' | 'cloud';
  settings: LocalChatDefaultSettings;
}): ResolvedExperiencePolicy['mediaPolicy']['nsfwPolicy'] {
  if (input.routeSource === 'cloud') {
    return 'local-only';
  }
  if (input.settings.visualComfortLevel === 'natural-visuals') {
    return 'allowed';
  }
  return 'disabled';
}

function deriveDeliveryStyle(input: {
  interactionProfile: DerivedInteractionProfile;
  interactionSnapshot: InteractionSnapshot | null;
}): LocalChatDefaultSettings['deliveryStyle'] {
  const snapshot = input.interactionSnapshot;
  if (
    snapshot
    && (
      snapshot.openLoops.length > 0
      || snapshot.assistantCommitments.length > 0
      || snapshot.relationshipState === 'warm'
      || snapshot.relationshipState === 'intimate'
    )
  ) {
    return 'natural';
  }
  if (
    snapshot
    && snapshot.conversationMomentum === 'cooling'
    && (snapshot.relationshipState === 'new' || snapshot.relationshipState === 'friendly')
    && snapshot.openLoops.length === 0
    && snapshot.assistantCommitments.length === 0
  ) {
    return 'compact';
  }
  return input.interactionProfile.expression.pacingBias === 'reserved'
    ? 'compact'
    : 'natural';
}

function deriveRelationshipBoundaryPreset(input: {
  interactionProfile: DerivedInteractionProfile;
  interactionSnapshot: InteractionSnapshot | null;
}): LocalChatDefaultSettings['relationshipBoundaryPreset'] {
  const relationshipState = input.interactionSnapshot?.relationshipState || 'new';
  const intimacyGuard = input.interactionProfile.relationship.intimacyGuard;
  const flirtAffinity = input.interactionProfile.relationship.flirtAffinity;
  if (intimacyGuard === 'strict' || flirtAffinity === 'none' || relationshipState === 'new') {
    return 'reserved';
  }
  if (intimacyGuard === 'open' && flirtAffinity === 'high' && relationshipState === 'intimate') {
    return 'close';
  }
  return 'balanced';
}

export function compileResolvedExperiencePolicy(input: {
  interactionProfile: DerivedInteractionProfile;
  interactionSnapshot: InteractionSnapshot | null;
  settings: LocalChatDefaultSettings;
  requestedVoiceConversationMode?: VoiceConversationMode;
  routeSource?: string | null;
}): ResolvedExperiencePolicy {
  const routeSource = resolveRouteSource(input.routeSource);
  const relationshipState = input.interactionSnapshot?.relationshipState || 'new';
  const selectedVoiceId = String(input.settings.voiceName || input.interactionProfile.voice.voiceId || '').trim() || null;
  const deliveryStyle = deriveDeliveryStyle({
    interactionProfile: input.interactionProfile,
    interactionSnapshot: input.interactionSnapshot,
  });
  const relationshipBoundaryPreset = deriveRelationshipBoundaryPreset({
    interactionProfile: input.interactionProfile,
    interactionSnapshot: input.interactionSnapshot,
  });
  return {
    deliveryPolicy: {
      style: deliveryStyle,
      allowMultiReply: deliveryStyle === 'natural',
    },
    voicePolicy: {
      enabled: input.settings.enableVoice,
      autonomy: input.settings.enableVoice ? input.settings.voiceAutonomy : 'off',
      conversationMode: resolveVoiceConversationMode({
        requestedMode: input.requestedVoiceConversationMode,
        settings: input.settings,
      }),
      autoPlayReplies: input.settings.autoPlayVoiceReplies,
      selectedVoiceId,
      selectionMode: String(input.settings.voiceName || '').trim() ? 'manual' : 'auto',
    },
    mediaPolicy: {
      autonomy: input.settings.mediaAutonomy,
      visualComfortLevel: input.settings.visualComfortLevel,
      routeSource,
      nsfwPolicy: resolveNsfwPolicy({
        routeSource,
        settings: input.settings,
      }),
      allowVisualAuto: input.settings.mediaAutonomy === 'natural' && input.settings.visualComfortLevel !== 'text-only',
      allowAutoVisualHighRisk: relationshipBoundaryPreset === 'close',
    },
    contentBoundary: {
      relationshipBoundaryPreset,
      visualComfortLevel: input.settings.visualComfortLevel,
      routeSource,
      relationshipState,
    },
    inspectFlags: {
      diagnosticsVisible: input.settings.diagnosticsVisible,
      runtimeInspectorVisible: input.settings.runtimeInspectorVisible,
    },
  };
}

export function applyResolvedContentBoundaryHint(input: {
  contextPacket: Pick<LocalChatContextPacket, 'contentBoundaryHint'>;
  policy: ResolvedExperiencePolicy;
}): void {
  input.contextPacket.contentBoundaryHint = {
    visualComfortLevel: input.policy.contentBoundary.visualComfortLevel,
    relationshipBoundaryPreset: input.policy.contentBoundary.relationshipBoundaryPreset,
  };
}
