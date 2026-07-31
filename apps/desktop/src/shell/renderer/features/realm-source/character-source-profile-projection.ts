import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import {
  projectWorldPublicSourceCard,
  type WorldPublicAssetDto,
  type WorldPublicSourceCardDto,
} from '../world/data/world-public-projection.js';

export type CharacterProfileCoreDto = RealmModel<'CharacterProfileCoreDto'>;

export type CharacterProfileMilestoneProjection = {
  id: string;
  title: string;
  summary: string | null;
  sequence: number | null;
  timeLabel: string | null;
  kind: 'biography' | 'entry' | 'office' | 'work';
  derived: boolean;
};

export type CharacterProfileRelationshipProjection = {
  id: string;
  type: string;
  targetRef: string | null;
  summary: string;
};

export type CharacterProfileInteractionProjection = {
  tone: string | null;
  cadence: string | null;
  scenario: string | null;
  greeting: string | null;
};

export type CharacterProfileProjection = {
  role: string | null;
  archetype: string | null;
  traits: string[];
  knowledgeTopics: string[];
  knowledgeConstraints: string[];
  interactionModes: string[];
  milestones: CharacterProfileMilestoneProjection[];
  relationshipNotes: CharacterProfileRelationshipProjection[];
  conversationAnchors: string[];
  interaction: CharacterProfileInteractionProjection | null;
};

export type CharacterSourceViewerRelationProjection = {
  state: WorldPublicSourceCardDto['relation']['state'];
  connectionId: string | null;
  runtimeSourceRef: string | null;
};

export type CharacterSourceProfileProjection = {
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  portraitUrl: string | null;
  profileCoverUrl: string | null;
  referenceImageUrl: string | null;
  voiceSampleUrl: string | null;
  voiceSample: WorldPublicAssetDto | null;
  mediaAssets: {
    avatar: WorldPublicAssetDto | null;
    portrait: WorldPublicAssetDto | null;
    profileCover: WorldPublicAssetDto | null;
    referenceImage: WorldPublicAssetDto | null;
    voiceSample: WorldPublicAssetDto | null;
  };
  bio: string;
  tags: string[];
  ownership: WorldPublicSourceCardDto['ownership'];
  worldName: string;
  viewerRelation: CharacterSourceViewerRelationProjection;
  characterProfile: CharacterProfileProjection;
};

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized || null;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const normalized = nonEmpty(value);
    if (normalized && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}

function biographyMilestoneKind(
  kind: NonNullable<WorldPublicSourceCardDto['characterBiography']>['lifeEvents'][number]['kind'],
): CharacterProfileMilestoneProjection['kind'] {
  if (kind === 'office') return 'office';
  if (kind === 'work') return 'work';
  if (kind === 'relationship') return 'entry';
  return 'biography';
}

function projectMilestones(
  profile: CharacterProfileCoreDto,
  source: WorldPublicSourceCardDto,
): CharacterProfileMilestoneProjection[] {
  const byId = new Map<string, CharacterProfileMilestoneProjection>();
  for (const milestone of profile.narrative.milestones ?? []) {
    const title = nonEmpty(milestone.title) ?? nonEmpty(milestone.summary);
    if (!title) continue;
    byId.set(milestone.milestoneId, {
      id: milestone.milestoneId,
      title,
      summary: nonEmpty(milestone.summary),
      sequence: milestone.sequence ?? null,
      timeLabel: null,
      kind: 'biography',
      derived: false,
    });
  }
  for (const event of source.characterBiography?.lifeEvents ?? []) {
    byId.set(event.id, {
      id: event.id,
      title: event.title,
      summary: nonEmpty(event.summary),
      sequence: event.sequence ?? null,
      timeLabel: nonEmpty(event.periodLabel),
      kind: biographyMilestoneKind(event.kind),
      derived: event.source === 'relationshipSummary',
    });
  }
  return [...byId.values()].sort((left, right) => (
    (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER)
      || left.title.localeCompare(right.title)
  ));
}

function projectInteraction(
  profile: CharacterProfileCoreDto,
): CharacterProfileInteractionProjection | null {
  const interaction = {
    tone: nonEmpty(profile.interactionProfile.tone),
    cadence: nonEmpty(profile.interactionProfile.cadence),
    scenario: nonEmpty(profile.interactionProfile.scenario),
    greeting: nonEmpty(profile.interactionProfile.greeting),
  };
  return Object.values(interaction).some(Boolean) ? interaction : null;
}

export function projectCharacterSourceProfile(
  profile: CharacterProfileCoreDto,
  source: WorldPublicSourceCardDto,
): CharacterSourceProfileProjection {
  const publicProjection = projectWorldPublicSourceCard(source);
  const dialogueAnchors = (profile.interactionProfile.dialogueExemplars ?? [])
    .flatMap((exemplar) => [nonEmpty(exemplar.user), nonEmpty(exemplar.character)]);
  const knowledgeTopics = uniqueStrings(profile.knowledge?.topics ?? []);
  const knowledgeConstraints = uniqueStrings(profile.knowledge?.constraints ?? []);
  const mediaAssets = publicProjection.mediaAssets ?? {};
  return {
    displayName: publicProjection.name,
    handle: publicProjection.handle ?? '',
    avatarUrl: publicProjection.avatarUrl ?? null,
    portraitUrl: publicProjection.portraitUrl ?? null,
    profileCoverUrl: publicProjection.profileCoverUrl ?? null,
    referenceImageUrl: publicProjection.referenceImageUrl ?? null,
    voiceSampleUrl: publicProjection.voiceSampleUrl ?? null,
    voiceSample: mediaAssets.voiceSample ?? null,
    mediaAssets: {
      avatar: mediaAssets.avatar ?? null,
      portrait: mediaAssets.portrait ?? null,
      profileCover: mediaAssets.profileCover ?? null,
      referenceImage: mediaAssets.referenceImage ?? null,
      voiceSample: mediaAssets.voiceSample ?? null,
    },
    bio: publicProjection.bio ?? profile.narrative.summary,
    tags: uniqueStrings(source.tags),
    ownership: source.ownership,
    worldName: source.worldName,
    viewerRelation: {
      state: source.relation.state,
      connectionId: nonEmpty(source.relation.connectionId),
      runtimeSourceRef: nonEmpty(source.relation.runtimeSourceRef),
    },
    characterProfile: {
      role: nonEmpty(source.role),
      archetype: nonEmpty(profile.narrative.archetype),
      traits: uniqueStrings(profile.narrative.traits ?? []),
      knowledgeTopics,
      knowledgeConstraints,
      interactionModes: uniqueStrings(profile.interactionProfile.interactionModes),
      milestones: projectMilestones(profile, source),
      relationshipNotes: (profile.relationships ?? [])
        .flatMap((relationship) => {
          const summary = nonEmpty(relationship.summary);
          return summary
            ? [{
                id: relationship.relationshipId,
                type: relationship.relationType,
                targetRef: relationship.targetRef.entityId,
                summary,
              }]
            : [];
        }),
      conversationAnchors: uniqueStrings([
        ...(profile.interactionProfile.greetingVariants ?? []),
        ...dialogueAnchors,
        ...knowledgeTopics,
        ...knowledgeConstraints,
      ]),
      interaction: projectInteraction(profile),
    },
  };
}
