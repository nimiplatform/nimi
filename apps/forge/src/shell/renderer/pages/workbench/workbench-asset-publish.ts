import type {
  AgentDeliverableStatus,
  WorldOwnedAgentRoster,
  WorldOwnedAgentRosterItem,
} from '@renderer/hooks/use-agent-queries.js';
import type { WorldDeliverableStatus } from '@renderer/hooks/use-world-queries.js';
import {
  selectAgentAssetOpsCandidates,
  useAgentAssetOpsStore,
} from '@renderer/state/agent-asset-ops-store.js';
import {
  isAgentDeliverableRequiredForPublish,
  isWorldDeliverableRequiredForPublish,
  type AgentDeliverableFamily,
} from '@renderer/features/asset-ops/deliverable-registry.js';
import type {
  AgentDraftState,
  WorldDraftState,
} from '@renderer/features/workbench/types.js';

export type WorkbenchCanonicalPublishContext = {
  worldDeliverables?: WorldDeliverableStatus[];
  agentRoster?: WorldOwnedAgentRoster | null;
};

export type WorkbenchWorldPublishAssets = {
  iconUrl: string | null;
  iconResourceId: string | null;
  coverUrl: string | null;
  coverResourceId: string | null;
  issues: string[];
};

export type WorkbenchAgentPublishAssets = {
  avatarUrl: string | null;
  greeting: string;
  voiceDemoUrl: string | null;
  voiceDemoResourceId: string | null;
  issues: string[];
};

const EXPLICIT_DIRECT_FIELD_LIFECYCLES = new Set(['confirmed', 'bound']);

function findWorldDeliverable(
  deliverables: WorldDeliverableStatus[] | undefined,
  family: 'world-icon' | 'world-cover',
): WorldDeliverableStatus | null {
  return deliverables?.find((item) => item.family === family) ?? null;
}

function findAgentDeliverable(
  deliverables: AgentDeliverableStatus[] | undefined,
  family: AgentDeliverableFamily,
): AgentDeliverableStatus | null {
  return deliverables?.find((item) => item.family === family) ?? null;
}

function findRosterItem(
  roster: WorldOwnedAgentRoster | null | undefined,
  agentId: string | null,
): WorldOwnedAgentRosterItem | null {
  if (!roster || !agentId) {
    return null;
  }
  return roster.items.find((item) => item.id === agentId) ?? null;
}

function hasExplicitLocalAvatarPublishState(input: {
  userId?: string | null;
  agentId: string;
  avatarUrl: string | null;
}): boolean {
  if (!input.avatarUrl) {
    return false;
  }
  if (!input.userId) {
    return true;
  }
  const localCandidates = selectAgentAssetOpsCandidates(useAgentAssetOpsStore.getState().profiles, {
    userId: input.userId,
    agentId: input.agentId,
  });
  return localCandidates.some((candidate) =>
    candidate.family === 'agent-avatar'
    && EXPLICIT_DIRECT_FIELD_LIFECYCLES.has(candidate.lifecycle)
    && candidate.previewUrl === input.avatarUrl,
  );
}

function hasExplicitLocalGreetingPublishState(input: {
  userId?: string | null;
  agentId: string;
  greetingText: string;
}): boolean {
  if (!input.greetingText) {
    return false;
  }
  if (!input.userId) {
    return true;
  }
  const localCandidates = selectAgentAssetOpsCandidates(useAgentAssetOpsStore.getState().profiles, {
    userId: input.userId,
    agentId: input.agentId,
  });
  return localCandidates.some((candidate) =>
    candidate.family === 'agent-greeting-primary'
    && EXPLICIT_DIRECT_FIELD_LIFECYCLES.has(candidate.lifecycle)
    && candidate.text === input.greetingText,
  );
}

export function resolveWorkbenchWorldPublishAssets(input: {
  worldDraft: WorldDraftState;
  context?: WorkbenchCanonicalPublishContext;
}): WorkbenchWorldPublishAssets {
  const issues: string[] = [];
  const worldId = String(input.worldDraft.worldId || '').trim();
  const coverRequired = isWorldDeliverableRequiredForPublish('world-cover');
  const iconRequired = isWorldDeliverableRequiredForPublish('world-icon');
  if (!worldId) {
    return {
      iconUrl: input.worldDraft.iconUrl,
      iconResourceId: null,
      coverUrl: input.worldDraft.bannerUrl,
      coverResourceId: null,
      issues: [
        ...(coverRequired && !input.worldDraft.bannerUrl ? ['World cover is required.'] : []),
        ...(iconRequired && !input.worldDraft.iconUrl ? ['World icon is required.'] : []),
      ],
    };
  }

  if (!input.context?.worldDeliverables) {
    return {
      iconUrl: null,
      iconResourceId: null,
      coverUrl: null,
      coverResourceId: null,
      issues: [
        'Canonical world asset completeness is unavailable for publish validation.',
      ],
    };
  }

  const icon = findWorldDeliverable(input.context.worldDeliverables, 'world-icon');
  const cover = findWorldDeliverable(input.context.worldDeliverables, 'world-cover');

  const iconBound = icon?.opsState === 'BOUND';
  const coverBound = cover?.opsState === 'BOUND';
  const iconUrl = icon?.value ?? null;
  const coverUrl = cover?.value ?? null;
  const iconResourceId = icon?.objectId ?? null;
  const coverResourceId = cover?.objectId ?? null;

  if (coverRequired && !coverBound) {
    issues.push('World cover must be bound in canonical world asset ops before publish.');
  } else if (coverRequired) {
    if (!coverUrl) issues.push('World cover URL is unavailable from the canonical world record.');
    if (!coverResourceId) issues.push('World cover resource binding is unavailable from canonical world asset ops.');
  }

  if (iconRequired && !iconBound) {
    issues.push('World icon must be bound in canonical world asset ops before publish.');
  } else if (iconRequired) {
    if (!iconUrl) issues.push('World icon URL is unavailable from the canonical world record.');
    if (!iconResourceId) issues.push('World icon resource binding is unavailable from canonical world asset ops.');
  }

  return {
    iconUrl,
    iconResourceId,
    coverUrl,
    coverResourceId,
    issues,
  };
}

export function resolveWorkbenchAgentPublishAssets(input: {
  userId?: string | null;
  agentDraft: AgentDraftState;
  context?: WorkbenchCanonicalPublishContext;
}): WorkbenchAgentPublishAssets {
  const issues: string[] = [];
  const avatarRequired = isAgentDeliverableRequiredForPublish('agent-avatar');
  const greetingRequired = isAgentDeliverableRequiredForPublish('agent-greeting-primary');
  const voiceDemoRequired = isAgentDeliverableRequiredForPublish('agent-voice-demo');
  if (!input.agentDraft.sourceAgentId) {
    return {
      avatarUrl: input.agentDraft.avatarUrl,
      greeting: String(input.agentDraft.greeting || '').trim(),
      voiceDemoUrl: input.agentDraft.voiceDemoUrl,
      voiceDemoResourceId: input.agentDraft.voiceDemoResourceId,
      issues: [
        ...(avatarRequired && !input.agentDraft.avatarUrl ? [`${input.agentDraft.displayName}: avatar is required.`] : []),
        ...(greetingRequired && !String(input.agentDraft.greeting || '').trim()
          ? [`${input.agentDraft.displayName}: greeting is required.`]
          : []),
        ...(voiceDemoRequired && !input.agentDraft.voiceDemoUrl ? [`${input.agentDraft.displayName}: voice demo is required.`] : []),
        ...(voiceDemoRequired && input.agentDraft.voiceDemoUrl && !input.agentDraft.voiceDemoResourceId
          ? [`${input.agentDraft.displayName}: voice demo resource binding is required.`]
          : []),
      ],
    };
  }

  const rosterItem = findRosterItem(input.context?.agentRoster, input.agentDraft.sourceAgentId);
  if (!rosterItem) {
    issues.push(`${input.agentDraft.displayName}: canonical agent detail is unavailable for publish validation.`);
    return {
      avatarUrl: null,
      greeting: '',
      voiceDemoUrl: null,
      voiceDemoResourceId: null,
      issues,
    };
  }

  const avatar = findAgentDeliverable(rosterItem.deliverables, 'agent-avatar');
  const greeting = findAgentDeliverable(rosterItem.deliverables, 'agent-greeting-primary');
  const voiceDemo = findAgentDeliverable(rosterItem.deliverables, 'agent-voice-demo');
  const rosterAvatarUrl = avatar?.currentState !== 'MISSING' ? rosterItem.avatarUrl ?? null : null;
  const rosterGreetingText = greeting?.currentState !== 'MISSING' ? String(rosterItem.greeting || '').trim() : '';
  const avatarUrl = hasExplicitLocalAvatarPublishState({
    userId: input.userId,
    agentId: input.agentDraft.sourceAgentId,
    avatarUrl: rosterAvatarUrl,
  })
    ? rosterAvatarUrl
    : null;
  const greetingText = hasExplicitLocalGreetingPublishState({
    userId: input.userId,
    agentId: input.agentDraft.sourceAgentId,
    greetingText: rosterGreetingText,
  })
    ? rosterGreetingText
    : '';
  const voiceDemoBound = voiceDemo?.opsState === 'BOUND';
  const voiceDemoResourceId = voiceDemoBound ? voiceDemo?.objectId ?? null : null;
  const voiceDemoUrl =
    voiceDemoBound
    && voiceDemoResourceId
    && input.agentDraft.voiceDemoResourceId === voiceDemoResourceId
    && input.agentDraft.voiceDemoUrl
      ? input.agentDraft.voiceDemoUrl
      : null;

  if (avatarRequired && !avatarUrl) {
    issues.push(rosterAvatarUrl
      ? `${input.agentDraft.displayName}: avatar must be adopted into local agent asset ops before publish.`
      : `${input.agentDraft.displayName}: avatar must be present on the canonical agent record before publish.`);
  }
  if (greetingRequired && !greetingText) {
    issues.push(rosterGreetingText
      ? `${input.agentDraft.displayName}: greeting must be adopted into local agent asset ops before publish.`
      : `${input.agentDraft.displayName}: greeting must be present on the canonical agent record before publish.`);
  }
  if (voiceDemoRequired && (!voiceDemoBound || !voiceDemoResourceId)) {
    issues.push(`${input.agentDraft.displayName}: voice demo must be bound in canonical agent asset ops before publish.`);
  } else if (voiceDemoRequired && !voiceDemoUrl) {
    issues.push(`${input.agentDraft.displayName}: voice demo handoff storage reference is unavailable for publish.`);
  }

  return {
    avatarUrl,
    greeting: greetingText,
    voiceDemoUrl,
    voiceDemoResourceId,
    issues,
  };
}
