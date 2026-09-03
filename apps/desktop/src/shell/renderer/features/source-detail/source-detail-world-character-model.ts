import type {
  CharacterProfileInteractionProjection,
  CharacterProfileMilestoneProjection,
  CharacterProfileProjection,
  CharacterProfileRelationshipProjection,
} from '../realm-source/character-source-profile-projection.js';

export {
  readRelationshipClues,
  readRelationshipRows,
  readRelationshipTargetLabels,
} from './source-detail-world-character-relationships.js';
export {
  dedupeWorks,
  readWorldCharacterWorksFromRelationships,
} from './source-detail-world-character-works.js';
export { readCareerMilestonesFromRelationships } from './source-detail-world-character-milestones.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isCharacterProfileMilestone(value: unknown): value is CharacterProfileMilestoneProjection {
  const milestone = asRecord(value);
  if (!milestone) {
    return false;
  }
  const kind = milestone.kind;
  return typeof milestone.id === 'string'
    && typeof milestone.title === 'string'
    && isNullableString(milestone.summary)
    && (milestone.sequence === null || (
      typeof milestone.sequence === 'number'
      && Number.isFinite(milestone.sequence)
    ))
    && isNullableString(milestone.timeLabel)
    && (kind === 'biography' || kind === 'entry' || kind === 'office' || kind === 'work')
    && typeof milestone.derived === 'boolean';
}

function isCharacterProfileRelationship(value: unknown): value is CharacterProfileRelationshipProjection {
  const relationship = asRecord(value);
  return Boolean(relationship
    && typeof relationship.id === 'string'
    && typeof relationship.type === 'string'
    && isNullableString(relationship.targetRef)
    && typeof relationship.summary === 'string');
}

function isCharacterProfileInteraction(value: unknown): value is CharacterProfileInteractionProjection | null {
  if (value === null) {
    return true;
  }
  const interaction = asRecord(value);
  return Boolean(interaction
    && isNullableString(interaction.tone)
    && isNullableString(interaction.cadence)
    && isNullableString(interaction.scenario)
    && isNullableString(interaction.greeting));
}

function isCharacterProfileProjection(value: unknown): value is CharacterProfileProjection {
  const profile = asRecord(value);
  return Boolean(profile
    && isNullableString(profile.role)
    && isNullableString(profile.archetype)
    && isStringArray(profile.traits)
    && isStringArray(profile.knowledgeTopics)
    && isStringArray(profile.knowledgeConstraints)
    && isStringArray(profile.interactionModes)
    && Array.isArray(profile.milestones)
    && profile.milestones.every(isCharacterProfileMilestone)
    && Array.isArray(profile.relationshipNotes)
    && profile.relationshipNotes.every(isCharacterProfileRelationship)
    && isStringArray(profile.conversationAnchors)
    && isCharacterProfileInteraction(profile.interaction));
}

export function readCharacterProfile(
  profileProjection: unknown,
): CharacterProfileProjection | null {
  return isCharacterProfileProjection(profileProjection) ? profileProjection : null;
}
