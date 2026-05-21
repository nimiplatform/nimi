import { describe, expect, it } from 'vitest';
import {
  RAW_RULE_REVIEW_DEFERRED_REASON,
  assertNoForbiddenOwnerSettingsFields,
  buildRealmOwnerAgentSettingsUpdateInput,
  createOwnerAgentSettingsDraft,
  normalizeOwnerAgentSettingsDraft,
  type OwnerAgentSettingsSnapshot,
} from './setting-proposal.js';

const settings: OwnerAgentSettingsSnapshot = {
  displayName: 'Mira',
  description: 'Quiet strategist',
  greeting: 'Welcome in.',
  naturalLanguageIntent: null,
  identity: {
    publicRole: 'Guide',
    worldview: 'The world is layered.',
  },
  personality: {
    summary: 'Patient and practical.',
    relationshipMode: 'mentor',
    interests: ['strategy', 'tea'],
    goals: ['keep lore coherent'],
  },
  communication: {
    contentStyle: 'Concise.',
    formality: 'casual',
    responseLength: 'medium',
    sentiment: 'neutral',
  },
  boundaries: {
    allowedThemes: ['adventure'],
    disallowedThemes: ['gore'],
  },
  positioning: {
    targetAudience: 'builders',
    positioning: 'operational guide',
  },
};

describe('owner settings proposal normalization', () => {
  it('creates an editable draft from owner settings DTO shape', () => {
    expect(createOwnerAgentSettingsDraft(settings)).toMatchObject({
      displayName: 'Mira',
      description: 'Quiet strategist',
      publicRole: 'Guide',
      interestsText: 'strategy, tea',
      allowedThemesText: 'adventure',
      rawRuleTextCandidate: '',
    });
  });

  it('normalizes text, enums, and list fields without introducing hidden keys', () => {
    expect(normalizeOwnerAgentSettingsDraft({
      ...createOwnerAgentSettingsDraft(settings),
      displayName: '  Mira   Prime  ',
      interestsText: 'strategy, ruins\ntea',
      allowedThemesText: ' adventure, friendship ',
      rawRuleTextCandidate: '  Keep replies practical.\r\nAvoid spoilers.  ',
    })).toMatchObject({
      displayName: 'Mira Prime',
      interests: ['strategy', 'ruins', 'tea'],
      allowedThemes: ['adventure', 'friendship'],
      rawRuleTextCandidate: 'Keep replies practical.\nAvoid spoilers.',
    });
  });

  it('builds an UpdateOwnerAgentSettingsDto diff and excludes raw rule text', () => {
    const result = buildRealmOwnerAgentSettingsUpdateInput({
      ...createOwnerAgentSettingsDraft(settings),
      displayName: 'Mira Prime',
      worldview: 'The world is layered and negotiated.',
      interestsText: 'strategy, tea, ruins',
      formality: 'formal',
      rawRuleTextCandidate: 'Visible rule candidate only.',
    }, settings);

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      input: {
        displayName: 'Mira Prime',
        identity: {
          worldview: 'The world is layered and negotiated.',
        },
        personality: {
          interests: ['strategy', 'tea', 'ruins'],
        },
        communication: {
          formality: 'formal',
        },
      },
    });
    expect(JSON.stringify(result.input)).not.toContain('Visible rule candidate only.');
    expect(result.ok ? result.preview.rawRuleReview?.reason : '').toBe(RAW_RULE_REVIEW_DEFERRED_REASON);
    expect(result.ok ? result.preview.submitted : {}).not.toHaveProperty('profileCoverUrl');
    expect(result.ok ? result.preview.submitted : {}).not.toHaveProperty('agentRules');
  });

  it('fails closed when only raw rule review changed', () => {
    expect(buildRealmOwnerAgentSettingsUpdateInput({
      ...createOwnerAgentSettingsDraft(settings),
      rawRuleTextCandidate: 'Only raw rule review.',
    }, settings)).toMatchObject({
      ok: false,
      failure: 'raw-rule-review-deferred',
      errors: [RAW_RULE_REVIEW_DEFERRED_REASON],
      input: null,
    });
  });

  it('rejects invalid enum values before Realm submission', () => {
    expect(buildRealmOwnerAgentSettingsUpdateInput({
      ...createOwnerAgentSettingsDraft(settings),
      formality: 'robotic',
    }, settings)).toMatchObject({
      ok: false,
      failure: 'owner-settings-invalid',
      input: null,
    });
  });

  it('detects forbidden owner settings fields recursively', () => {
    expect(assertNoForbiddenOwnerSettingsFields({
      submitted: {
        provider: 'forbidden',
      },
    })).toBe('provider');
    expect(assertNoForbiddenOwnerSettingsFields({
      submitted: {
        profileCoverUrl: 'https://cdn.example.test/cover.png',
      },
    })).toBe('profileCoverUrl');
    expect(assertNoForbiddenOwnerSettingsFields({
      submitted: {
        identity: {
          worldview: 'Allowed',
        },
      },
    })).toBeNull();
  });
});
