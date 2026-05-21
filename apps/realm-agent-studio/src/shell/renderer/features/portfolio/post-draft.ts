import type { OwnerPortfolioAgentDetail } from './portfolio-data.js';

export const ATTACHMENT_TARGET_TYPES = ['RESOURCE', 'ASSET', 'BUNDLE'] as const;

export type AttachmentTargetType = typeof ATTACHMENT_TARGET_TYPES[number];

export type LocalPostDraftInput = {
  caption: string;
  tagsText: string;
  humanReviewed: boolean;
  attachmentEnabled: boolean;
  attachmentTargetType: AttachmentTargetType;
  attachmentTargetId: string;
};

export type LocalPostDraft = {
  caption: string;
  tags: string[];
  humanReviewed: boolean;
  attachment: {
    enabled: boolean;
    targetType: AttachmentTargetType;
    targetId: string;
  };
};

export type CandidatePostPayload = {
  candidate: true;
  source: 'realm-agent-studio.local-post-draft';
  agentRef: {
    source: 'Realm MeService.getMyRealmAgent';
    agentKey: string;
    handle: string;
    displayName: string;
  };
  realmCreatePost: {
    attachments: Array<{
      targetType: AttachmentTargetType;
      targetId: string;
    }>;
    caption?: string;
    tags?: string[];
  };
  review: {
    humanReviewed: true;
  };
};

export type LocalPostScheduleInput = {
  localDate: string;
  localTime: string;
};

export type NormalizedLocalPostScheduleInput = {
  localRunAt: string;
  runAtDate: Date;
};

export type LocalPostScheduleCandidate = {
  candidate: true;
  source: 'realm-agent-studio.local-single-post-schedule';
  appLocalOnly: true;
  localRunAt: string;
  boundary: {
    scope: 'app-local-only';
    realmPublish: 'not-created';
    realmScheduling: 'not-created';
    moderation: 'not-claimed';
  };
  postCandidate: CandidatePostPayload;
};

export type PostDraftValidationResult =
  | {
    publishable: true;
    errors: [];
    payload: CandidatePostPayload;
  }
  | {
    publishable: false;
    errors: string[];
    payload: null;
  };

export type LocalPostScheduleValidationResult =
  | {
    scheduleable: true;
    errors: [];
    candidate: LocalPostScheduleCandidate;
  }
  | {
    scheduleable: false;
    errors: string[];
    candidate: null;
  };

const FORBIDDEN_POST_PAYLOAD_KEYS = new Set([
  'worldId',
  'id',
  'authorId',
  'scheduledAt',
  'scheduleId',
  'queue',
  'campaign',
  'recurrence',
  'publicSuccess',
  'publishSuccess',
  'moderationSuccess',
]);

function normalizeTags(tagsText: string): string[] {
  const seen = new Set<string>();
  return tagsText
    .split(',')
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function isAllowedAttachmentTargetType(value: string): value is AttachmentTargetType {
  return ATTACHMENT_TARGET_TYPES.includes(value as AttachmentTargetType);
}

function assertNoForbiddenPayloadKeys(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_POST_PAYLOAD_KEYS.has(key)) {
      return key;
    }
    const nestedViolation = assertNoForbiddenPayloadKeys(nested);
    if (nestedViolation) {
      return nestedViolation;
    }
  }

  return null;
}

function formatLocalRunAt(date: string, time: string): string {
  return `${date}T${time}`;
}

export function normalizeLocalPostDraft(input: LocalPostDraftInput): LocalPostDraft {
  const attachmentTargetType = isAllowedAttachmentTargetType(input.attachmentTargetType)
    ? input.attachmentTargetType
    : 'RESOURCE';

  return {
    caption: input.caption.trim(),
    tags: normalizeTags(input.tagsText),
    humanReviewed: input.humanReviewed,
    attachment: {
      enabled: input.attachmentEnabled,
      targetType: attachmentTargetType,
      targetId: input.attachmentTargetId.trim(),
    },
  };
}

export function validateLocalPostDraft(
  input: LocalPostDraftInput,
  agent: OwnerPortfolioAgentDetail,
): PostDraftValidationResult {
  const draft = normalizeLocalPostDraft(input);
  const errors: string[] = [];

  if (!draft.caption) {
    errors.push('caption missing');
  }
  if (!draft.humanReviewed) {
    errors.push('candidate not publishable: human review missing');
  }
  if (draft.attachment.enabled && !draft.attachment.targetId) {
    errors.push('attachment validation failed: attachment target missing');
  }

  if (errors.length > 0) {
    return { publishable: false, errors, payload: null };
  }

  const payload: CandidatePostPayload = {
    candidate: true,
    source: 'realm-agent-studio.local-post-draft',
    agentRef: {
      source: agent.source,
      agentKey: agent.id,
      handle: agent.handle.value,
      displayName: agent.displayName.value,
    },
    realmCreatePost: {
      attachments: draft.attachment.enabled
        ? [{
          targetType: draft.attachment.targetType,
          targetId: draft.attachment.targetId,
        }]
        : [],
      ...(draft.caption ? { caption: draft.caption } : {}),
      ...(draft.tags.length > 0 ? { tags: draft.tags } : {}),
    },
    review: {
      humanReviewed: true,
    },
  };

  const forbiddenKey = assertNoForbiddenPayloadKeys(payload);
  if (forbiddenKey) {
    return {
      publishable: false,
      errors: [`post payload rejected: forbidden ${forbiddenKey} present`],
      payload: null,
    };
  }

  return { publishable: true, errors: [], payload };
}

export function normalizeLocalPostScheduleInput(input: LocalPostScheduleInput): NormalizedLocalPostScheduleInput | null {
  const localDate = input.localDate.trim();
  const localTime = input.localTime.trim();

  if (!localDate || !localTime) {
    return null;
  }

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (!dateMatch || !timeMatch) {
    return null;
  }

  const year = Number(dateMatch[1]);
  const monthIndex = Number(dateMatch[2]) - 1;
  const day = Number(dateMatch[3]);
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const runAtDate = new Date(year, monthIndex, day, hours, minutes);

  if (
    Number.isNaN(runAtDate.getTime())
    || runAtDate.getFullYear() !== year
    || runAtDate.getMonth() !== monthIndex
    || runAtDate.getDate() !== day
    || runAtDate.getHours() !== hours
    || runAtDate.getMinutes() !== minutes
  ) {
    return null;
  }

  return {
    localRunAt: formatLocalRunAt(localDate, localTime),
    runAtDate,
  };
}

export function buildLocalPostScheduleCandidate(
  postValidation: PostDraftValidationResult,
  input: LocalPostScheduleInput,
  now = new Date(),
): LocalPostScheduleValidationResult {
  const errors: string[] = [];

  if (!postValidation.publishable) {
    errors.push('app-local schedule unavailable: reviewed publishable local post draft required');
  }

  const normalized = normalizeLocalPostScheduleInput(input);
  if (!normalized) {
    errors.push('app-local schedule unavailable: local run date and time required');
  } else if (normalized.runAtDate.getTime() <= now.getTime()) {
    errors.push('app-local schedule unavailable: local run time must be in the future');
  }

  if (errors.length > 0 || !postValidation.publishable || !normalized) {
    return { scheduleable: false, errors, candidate: null };
  }

  const candidate: LocalPostScheduleCandidate = {
    candidate: true,
    source: 'realm-agent-studio.local-single-post-schedule',
    appLocalOnly: true,
    localRunAt: normalized.localRunAt,
    boundary: {
      scope: 'app-local-only',
      realmPublish: 'not-created',
      realmScheduling: 'not-created',
      moderation: 'not-claimed',
    },
    postCandidate: postValidation.payload,
  };

  const forbiddenKey = assertNoForbiddenPayloadKeys(candidate);
  if (forbiddenKey) {
    return {
      scheduleable: false,
      errors: [`app-local schedule rejected: forbidden ${forbiddenKey} present`],
      candidate: null,
    };
  }

  return { scheduleable: true, errors: [], candidate };
}
