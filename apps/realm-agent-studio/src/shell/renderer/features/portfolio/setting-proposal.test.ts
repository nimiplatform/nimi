import { describe, expect, it } from 'vitest';
import type { OwnerPortfolioAgentDetail, SettingField } from './portfolio-data.js';
import {
  SETTING_PROPOSAL_BLOCKED_REASON,
  assertNoForbiddenSettingProposalFields,
  buildBlockedSettingProposal,
  normalizeSettingProposalInput,
} from './setting-proposal.js';

function settingField(key: SettingField['key'], label: string, value: string): SettingField {
  return {
    key,
    label,
    value,
    status: value ? 'available' : 'source-unavailable',
    source: 'Realm MeService.getMyRealmAgent',
    readOnly: true,
    unavailableLabel: value ? undefined : 'setting read unavailable',
  };
}

const agent: OwnerPortfolioAgentDetail = {
  id: 'agent-1',
  displayName: settingField('displayName', 'Display name', 'Mira'),
  handle: settingField('handle', 'Handle', 'mira'),
  bio: settingField('bio', 'Bio', 'Quiet strategist'),
  greeting: settingField('greeting', 'Greeting', 'Welcome in.'),
  profileCoverUrl: settingField('profileCoverUrl', 'Profile cover URL', 'https://cdn.example.test/cover.png'),
  ownership: settingField('ownership', 'Ownership evidence', 'MASTER_OWNED'),
  world: settingField('world', 'World evidence', 'OASIS'),
  state: settingField('state', 'State evidence', 'ACTIVE'),
  avatarUrl: 'https://cdn.example.test/avatar.png',
  friendCount: { status: 'available', value: 7 },
  source: 'Realm MeService.getMyRealmAgent',
};

describe('setting proposal normalization', () => {
  it('normalizes editable proposal text without introducing hidden fields', () => {
    expect(normalizeSettingProposalInput({
      displayName: '  Mira   Prime  ',
      bio: '  Line one\r\nLine two  ',
      profileCoverUrl: '  https://cdn.example.test/new.png  ',
      ruleText: '  Keep replies practical.\r\nAvoid spoilers.  ',
      naturalLanguageInstruction: '  Make the public tone calmer.  ',
    })).toEqual({
      displayName: 'Mira Prime',
      bio: 'Line one\nLine two',
      profileCoverUrl: 'https://cdn.example.test/new.png',
      ruleText: 'Keep replies practical.\nAvoid spoilers.',
      naturalLanguageInstruction: 'Make the public tone calmer.',
    });
  });

  it('diffs changed profile fields separately from visible rule text', () => {
    const result = buildBlockedSettingProposal({
      displayName: 'Mira Prime',
      bio: 'Quiet strategist',
      profileCoverUrl: 'https://cdn.example.test/new-cover.png',
      ruleText: 'Stay in owner-approved public lore.',
      naturalLanguageInstruction: 'Make this stricter.',
    }, agent);

    expect(result.blocked).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.payload?.blockedReason).toBe(SETTING_PROPOSAL_BLOCKED_REASON);
    expect(result.payload?.creatorAgentUpdateCandidate).toEqual({
      displayName: 'Mira Prime',
      profileCoverUrl: 'https://cdn.example.test/new-cover.png',
    });
    expect(result.payload?.ruleTextCandidate).toEqual({
      text: 'Stay in owner-approved public lore.',
      ownerReviewed: false,
      source: 'visible owner-reviewed rule text candidate',
    });
    expect(result.payload).not.toHaveProperty('handle');
    expect(result.payload).not.toHaveProperty('avatarUrl');
  });

  it('omits unchanged and empty profile fields instead of creating destructive clears', () => {
    const result = buildBlockedSettingProposal({
      displayName: 'Mira',
      bio: '',
      profileCoverUrl: 'https://cdn.example.test/cover.png',
      ruleText: 'Visible rule candidate only.',
      naturalLanguageInstruction: '',
    }, agent);

    expect(result.changed).toBe(true);
    expect(result.payload?.creatorAgentUpdateCandidate).toEqual({});
    expect(result.payload?.ruleTextCandidate?.text).toBe('Visible rule candidate only.');
  });

  it('fails closed when no changed candidate remains', () => {
    const result = buildBlockedSettingProposal({
      displayName: 'Mira',
      bio: 'Quiet strategist',
      profileCoverUrl: 'https://cdn.example.test/cover.png',
      ruleText: '',
      naturalLanguageInstruction: 'Only local drafting text is not a save candidate.',
    }, agent);

    expect(result).toEqual({
      blocked: true,
      changed: false,
      errors: ['no changed admitted/source-evidence setting candidate'],
      payload: null,
    });
  });

  it('detects forbidden setting fields recursively', () => {
    expect(assertNoForbiddenSettingProposalFields({
      creatorAgentUpdateCandidate: {
        displayName: 'Mira',
        provider: 'forbidden',
      },
    })).toBe('provider');
    expect(assertNoForbiddenSettingProposalFields({
      localAgent: { model: 'forbidden' },
    })).toBe('localAgent');
    expect(assertNoForbiddenSettingProposalFields({
      creatorAgentUpdateCandidate: {
        bio: 'Allowed',
      },
    })).toBeNull();
  });
});
