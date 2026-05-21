import type { OwnerPortfolioAgentDetail } from './portfolio-data.js';

export const SETTING_PROPOSAL_BLOCKED_REASON = 'setting save blocked: admitted Realm owner update semantics are not available in Realm Agent Studio';

export type SettingProposalInput = {
  displayName: string;
  bio: string;
  profileCoverUrl: string;
  ruleText: string;
  naturalLanguageInstruction: string;
};

export type NormalizedSettingProposalInput = {
  displayName: string;
  bio: string;
  profileCoverUrl: string;
  ruleText: string;
  naturalLanguageInstruction: string;
};

export type CreatorAgentUpdateCandidate = Partial<{
  displayName: string;
  bio: string;
  profileCoverUrl: string;
}>;

export type BlockedSettingProposalPayload = {
  candidate: true;
  blocked: true;
  blockedReason: typeof SETTING_PROPOSAL_BLOCKED_REASON;
  source: 'realm-agent-studio.local-setting-proposal';
  agentRef: {
    source: 'Realm MeService.getMyRealmAgent';
    agentKey: string;
    displayName: string;
  };
  creatorAgentUpdateCandidate: CreatorAgentUpdateCandidate;
  ruleTextCandidate?: {
    text: string;
    ownerReviewed: false;
    source: 'visible owner-reviewed rule text candidate';
  };
  localInstruction?: {
    text: string;
    usedFor: 'local proposal drafting only';
  };
};

export type SettingProposalBuildResult =
  | {
    blocked: true;
    changed: true;
    errors: [];
    payload: BlockedSettingProposalPayload;
  }
  | {
    blocked: true;
    changed: false;
    errors: string[];
    payload: null;
  };

const FORBIDDEN_SETTING_PROPOSAL_KEYS = new Set([
  'handle',
  'worldId',
  'avatarUrl',
  'provider',
  'model',
  'localAgent',
  'lifecycle',
  'state',
  'personality',
  'worldview',
  'dna',
]);

function normalizeLineText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function compactProfileText(value: string): string {
  return normalizeLineText(value).replace(/[ \t]+/g, ' ');
}

function addChangedProfileField(
  candidate: CreatorAgentUpdateCandidate,
  key: keyof CreatorAgentUpdateCandidate,
  proposedValue: string,
  currentValue: string,
) {
  if (!proposedValue) {
    return;
  }
  if (proposedValue === currentValue.trim()) {
    return;
  }
  candidate[key] = proposedValue;
}

export function normalizeSettingProposalInput(input: SettingProposalInput): NormalizedSettingProposalInput {
  return {
    displayName: compactProfileText(input.displayName),
    bio: normalizeLineText(input.bio),
    profileCoverUrl: compactProfileText(input.profileCoverUrl),
    ruleText: normalizeLineText(input.ruleText),
    naturalLanguageInstruction: normalizeLineText(input.naturalLanguageInstruction),
  };
}

export function assertNoForbiddenSettingProposalFields(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_SETTING_PROPOSAL_KEYS.has(key)) {
      return key;
    }
    const nestedViolation = assertNoForbiddenSettingProposalFields(nested);
    if (nestedViolation) {
      return nestedViolation;
    }
  }

  return null;
}

export function buildBlockedSettingProposal(
  input: SettingProposalInput,
  agent: OwnerPortfolioAgentDetail,
): SettingProposalBuildResult {
  const normalized = normalizeSettingProposalInput(input);
  const creatorAgentUpdateCandidate: CreatorAgentUpdateCandidate = {};

  addChangedProfileField(creatorAgentUpdateCandidate, 'displayName', normalized.displayName, agent.displayName.value);
  addChangedProfileField(creatorAgentUpdateCandidate, 'bio', normalized.bio, agent.bio.value);
  addChangedProfileField(creatorAgentUpdateCandidate, 'profileCoverUrl', normalized.profileCoverUrl, agent.profileCoverUrl.value);

  const hasCreatorCandidate = Object.keys(creatorAgentUpdateCandidate).length > 0;
  const hasRuleCandidate = Boolean(normalized.ruleText);

  if (!hasCreatorCandidate && !hasRuleCandidate) {
    return {
      blocked: true,
      changed: false,
      errors: ['no changed admitted/source-evidence setting candidate'],
      payload: null,
    };
  }

  const payload: BlockedSettingProposalPayload = {
    candidate: true,
    blocked: true,
    blockedReason: SETTING_PROPOSAL_BLOCKED_REASON,
    source: 'realm-agent-studio.local-setting-proposal',
    agentRef: {
      source: agent.source,
      agentKey: agent.id,
      displayName: agent.displayName.value,
    },
    creatorAgentUpdateCandidate,
    ...(hasRuleCandidate
      ? {
        ruleTextCandidate: {
          text: normalized.ruleText,
          ownerReviewed: false,
          source: 'visible owner-reviewed rule text candidate',
        },
      }
      : {}),
    ...(normalized.naturalLanguageInstruction
      ? {
        localInstruction: {
          text: normalized.naturalLanguageInstruction,
          usedFor: 'local proposal drafting only',
        },
      }
      : {}),
  };

  const forbiddenKey = assertNoForbiddenSettingProposalFields(payload);
  if (forbiddenKey) {
    return {
      blocked: true,
      changed: false,
      errors: [`setting proposal rejected: forbidden ${forbiddenKey} present`],
      payload: null,
    };
  }

  return {
    blocked: true,
    changed: true,
    errors: [],
    payload,
  };
}
