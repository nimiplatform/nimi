import { describe, expect, it } from 'vitest';
import type { OwnerPortfolioAgentDetail } from './portfolio-data.js';
import {
  buildLocalPostScheduleCandidate,
  normalizeLocalPostDraft,
  normalizeLocalPostScheduleInput,
  validateLocalPostDraft,
  type CandidatePostPayload,
  type LocalPostDraftInput,
} from './post-draft.js';

const agent: OwnerPortfolioAgentDetail = {
  id: 'agent-1',
  displayName: {
    key: 'displayName',
    label: 'Display name',
    value: 'Mira',
    status: 'available',
    source: 'Realm MeService.getMyRealmAgent',
    readOnly: true,
  },
  handle: {
    key: 'handle',
    label: 'Handle',
    value: 'mira',
    status: 'available',
    source: 'Realm MeService.getMyRealmAgent',
    readOnly: true,
  },
  bio: {
    key: 'bio',
    label: 'Bio',
    value: '',
    status: 'source-unavailable',
    source: 'Realm MeService.getMyRealmAgent',
    readOnly: true,
    unavailableLabel: 'setting read unavailable',
  },
  greeting: {
    key: 'greeting',
    label: 'Greeting',
    value: '',
    status: 'source-unavailable',
    source: 'Realm MeService.getMyRealmAgent',
    readOnly: true,
    unavailableLabel: 'setting read unavailable',
  },
  profileCoverUrl: {
    key: 'profileCoverUrl',
    label: 'Profile cover URL',
    value: '',
    status: 'source-unavailable',
    source: 'Realm MeService.getMyRealmAgent',
    readOnly: true,
    unavailableLabel: 'setting read unavailable',
  },
  ownership: {
    key: 'ownership',
    label: 'Ownership evidence',
    value: 'MASTER_OWNED',
    status: 'available',
    source: 'Realm MeService.getMyRealmAgent',
    readOnly: true,
  },
  world: {
    key: 'world',
    label: 'World evidence',
    value: 'world-1',
    status: 'available',
    source: 'Realm MeService.getMyRealmAgent',
    readOnly: true,
  },
  state: {
    key: 'state',
    label: 'State evidence',
    value: 'ACTIVE',
    status: 'available',
    source: 'Realm MeService.getMyRealmAgent',
    readOnly: true,
  },
  avatarUrl: null,
  friendCount: { status: 'available', value: 7 },
  source: 'Realm MeService.getMyRealmAgent',
};

const baseInput: LocalPostDraftInput = {
  caption: ' New artifact pass ',
  tagsText: ' art, #draft, art, studio ',
  humanReviewed: true,
  attachmentEnabled: true,
  attachmentTargetType: 'ASSET',
  attachmentTargetId: 'asset-1 ',
};

function collectKeys(value: unknown, keys = new Set<string>()) {
  if (!value || typeof value !== 'object') {
    return keys;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    keys.add(key);
    collectKeys(nested, keys);
  }
  return keys;
}

describe('local post draft normalization', () => {
  it('trims caption and normalizes distinct tags', () => {
    expect(normalizeLocalPostDraft(baseInput)).toMatchObject({
      caption: 'New artifact pass',
      tags: ['art', 'draft', 'studio'],
      attachment: {
        enabled: true,
        targetType: 'ASSET',
        targetId: 'asset-1',
      },
    });
  });

  it('falls back to RESOURCE when an unknown attachment target type reaches normalization', () => {
    const draft = normalizeLocalPostDraft({
      ...baseInput,
      attachmentTargetType: 'WORLD' as LocalPostDraftInput['attachmentTargetType'],
    });

    expect(draft.attachment.targetType).toBe('RESOURCE');
  });
});

describe('local post draft validation', () => {
  it('fails closed when human review is missing', () => {
    const result = validateLocalPostDraft({ ...baseInput, humanReviewed: false }, agent);

    expect(result.publishable).toBe(false);
    expect(result.errors).toContain('candidate not publishable: human review missing');
    expect(result.payload).toBeNull();
  });

  it('fails closed when attachment is enabled without a target', () => {
    const result = validateLocalPostDraft({ ...baseInput, attachmentTargetId: ' ' }, agent);

    expect(result.publishable).toBe(false);
    expect(result.errors).toContain('attachment validation failed: attachment target missing');
    expect(result.payload).toBeNull();
  });

  it('builds a reviewed candidate payload without forbidden Realm write fields', () => {
    const result = validateLocalPostDraft(baseInput, agent);

    expect(result.publishable).toBe(true);
    expect(result.payload).toEqual({
      candidate: true,
      source: 'realm-agent-studio.local-post-draft',
      agentRef: {
        source: 'Realm MeService.getMyRealmAgent',
        agentKey: 'agent-1',
        handle: 'mira',
        displayName: 'Mira',
      },
      realmCreatePost: {
        attachments: [{
          targetType: 'ASSET',
          targetId: 'asset-1',
        }],
        caption: 'New artifact pass',
        tags: ['art', 'draft', 'studio'],
      },
      review: {
        humanReviewed: true,
      },
    } satisfies CandidatePostPayload);
    expect(collectKeys(result.payload).has('worldId')).toBe(false);
    expect(collectKeys(result.payload).has('id')).toBe(false);
    expect(collectKeys(result.payload).has('authorId')).toBe(false);
  });

  it('omits attachment envelope when no local target is selected', () => {
    const result = validateLocalPostDraft({ ...baseInput, attachmentEnabled: false, attachmentTargetId: '' }, agent);

    expect(result.publishable).toBe(true);
    expect(result.payload?.realmCreatePost.attachments).toEqual([]);
  });
});

describe('app-local post schedule candidate', () => {
  it('normalizes local date and time input', () => {
    expect(normalizeLocalPostScheduleInput({
      localDate: ' 2026-05-22 ',
      localTime: ' 09:30 ',
    })).toMatchObject({
      localRunAt: '2026-05-22T09:30',
    });
  });

  it('rejects empty or malformed local run time', () => {
    expect(normalizeLocalPostScheduleInput({ localDate: '', localTime: '09:30' })).toBeNull();
    expect(normalizeLocalPostScheduleInput({ localDate: '2026/05/22', localTime: '09:30' })).toBeNull();
    expect(normalizeLocalPostScheduleInput({ localDate: '2026-05-22', localTime: '9:30' })).toBeNull();
    expect(normalizeLocalPostScheduleInput({ localDate: '2026-02-31', localTime: '09:30' })).toBeNull();
    expect(normalizeLocalPostScheduleInput({ localDate: '2026-05-22', localTime: '25:30' })).toBeNull();
  });

  it('wraps an already reviewed candidate payload without Realm schedule or success fields', () => {
    const postValidation = validateLocalPostDraft(baseInput, agent);
    const result = buildLocalPostScheduleCandidate(
      postValidation,
      { localDate: '2026-05-22', localTime: '09:30' },
      new Date('2026-05-21T09:30:00'),
    );

    expect(result.scheduleable).toBe(true);
    expect(result.candidate).toMatchObject({
      candidate: true,
      source: 'realm-agent-studio.local-single-post-schedule',
      appLocalOnly: true,
      localRunAt: '2026-05-22T09:30',
      boundary: {
        scope: 'app-local-only',
        realmPublish: 'not-created',
        realmScheduling: 'not-created',
        moderation: 'not-claimed',
      },
      postCandidate: postValidation.payload,
    });
    expect(collectKeys(result.candidate).has('scheduledAt')).toBe(false);
    expect(collectKeys(result.candidate).has('scheduleId')).toBe(false);
    expect(collectKeys(result.candidate).has('worldId')).toBe(false);
    expect(collectKeys(result.candidate).has('authorId')).toBe(false);
    expect(collectKeys(result.candidate).has('id')).toBe(false);
    expect(collectKeys(result.candidate).has('queue')).toBe(false);
    expect(collectKeys(result.candidate).has('campaign')).toBe(false);
    expect(collectKeys(result.candidate).has('recurrence')).toBe(false);
    expect(collectKeys(result.candidate).has('publicSuccess')).toBe(false);
    expect(collectKeys(result.candidate).has('publishSuccess')).toBe(false);
    expect(collectKeys(result.candidate).has('moderationSuccess')).toBe(false);
  });

  it('fails closed when the post draft is not reviewed and publishable', () => {
    const postValidation = validateLocalPostDraft({ ...baseInput, humanReviewed: false }, agent);
    const result = buildLocalPostScheduleCandidate(
      postValidation,
      { localDate: '2026-05-22', localTime: '09:30' },
      new Date('2026-05-21T09:30:00'),
    );

    expect(result.scheduleable).toBe(false);
    expect(result.errors).toContain('app-local schedule unavailable: reviewed publishable local post draft required');
    expect(result.candidate).toBeNull();
  });

  it('fails closed when the local run time is not future-ish', () => {
    const postValidation = validateLocalPostDraft(baseInput, agent);
    const result = buildLocalPostScheduleCandidate(
      postValidation,
      { localDate: '2026-05-21', localTime: '09:30' },
      new Date('2026-05-21T09:30:00'),
    );

    expect(result.scheduleable).toBe(false);
    expect(result.errors).toContain('app-local schedule unavailable: local run time must be in the future');
    expect(result.candidate).toBeNull();
  });
});
