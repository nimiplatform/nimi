type PublishIdentity = 'USER' | 'AGENT';
type PublishChannelId = 'INTERNAL_FEED' | 'INTERNAL_AGENT_PROFILE';
type PublishDraftStatus = 'DRAFT' | 'PUBLISHED';
type PublishAttachmentTargetType = 'RESOURCE' | 'ASSET' | 'BUNDLE';
type PublishAttachmentDisplayKind = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'TEXT' | 'CARD';

export type PublishChannel = {
  id: PublishChannelId;
  type: PublishChannelId;
  label: string;
  description: string;
  enabled: boolean;
};

export type PublishDraftAttachment = {
  targetType: PublishAttachmentTargetType;
  targetId: string;
  displayKind: PublishAttachmentDisplayKind;
};

export type PublishDraft = {
  id: string;
  title: string;
  caption: string;
  tags: string[];
  attachments: PublishDraftAttachment[];
  identity: PublishIdentity;
  agentId: string | null;
  status: PublishDraftStatus;
  createdAt: string;
  updatedAt: string;
  lastPublishedAt: string | null;
  lastPublishedPostId: string | null;
};

export type PublishWorkspaceState = {
  settings: {
    defaultIdentity: PublishIdentity;
    defaultAgentId: string | null;
    channels: Record<PublishChannelId, { enabled: boolean }>;
  };
  drafts: PublishDraft[];
};

const STORAGE_KEY = 'nimi:forge:publish-workspace';

const DEFAULT_STATE: PublishWorkspaceState = {
  settings: {
    defaultIdentity: 'USER',
    defaultAgentId: null,
    channels: {
      INTERNAL_FEED: { enabled: true },
      INTERNAL_AGENT_PROFILE: { enabled: false },
    },
  },
  drafts: [],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function parseIdentity(value: unknown): PublishIdentity {
  return String(value || 'USER') === 'AGENT' ? 'AGENT' : 'USER';
}

function parseChannelState(value: unknown, fallbackEnabled: boolean): { enabled: boolean } {
  const record = asRecord(value);
  return { enabled: typeof record.enabled === 'boolean' ? record.enabled : fallbackEnabled };
}

function parseAttachmentTargetType(value: unknown): PublishAttachmentTargetType | null {
  const normalized = String(value || '').trim();
  if (normalized === 'RESOURCE' || normalized === 'ASSET' || normalized === 'BUNDLE') {
    return normalized;
  }
  return null;
}

function parseAttachmentDisplayKind(value: unknown): PublishAttachmentDisplayKind | null {
  const normalized = String(value || '').trim();
  if (normalized === 'IMAGE') {
    return normalized;
  }
  if (
    normalized === 'VIDEO'
    || normalized === 'AUDIO'
    || normalized === 'TEXT'
    || normalized === 'CARD'
  ) {
    return normalized;
  }
  return null;
}

function parseDraftStatus(value: unknown): PublishDraftStatus {
  return String(value || 'DRAFT') === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT';
}

function normalizeAttachment(value: unknown): PublishDraftAttachment | null {
  const item = asRecord(value);
  const targetType = parseAttachmentTargetType(item.targetType);
  const displayKind = parseAttachmentDisplayKind(item.displayKind);
  const targetId = String(item.targetId || '').trim();
  if (!targetType || !displayKind || !targetId) {
    return null;
  }
  return {
    targetType,
    targetId,
    displayKind,
  };
}

function parseAttachments(value: unknown): PublishDraftAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeAttachment(item))
    .filter((item): item is PublishDraftAttachment => item !== null);
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((tag) => String(tag || '').trim()).filter(Boolean);
}

function loadState(): PublishWorkspaceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = asRecord(JSON.parse(raw));
    const settings = asRecord(parsed.settings);
    const channels = asRecord(settings.channels);
    const draftsRaw = Array.isArray(parsed.drafts) ? parsed.drafts : [];
    return {
      settings: {
        defaultIdentity: parseIdentity(settings.defaultIdentity),
        defaultAgentId: settings.defaultAgentId ? String(settings.defaultAgentId) : null,
        channels: {
          INTERNAL_FEED: parseChannelState(channels.INTERNAL_FEED, true),
          INTERNAL_AGENT_PROFILE: parseChannelState(channels.INTERNAL_AGENT_PROFILE, false),
        },
      },
      drafts: draftsRaw
        .map((draft) => asRecord(draft))
        .map((draft) => ({
          id: String(draft.id || '').trim(),
          title: String(draft.title || '').trim(),
          caption: String(draft.caption || ''),
          tags: parseTags(draft.tags),
          attachments: parseAttachments(draft.attachments),
          identity: parseIdentity(draft.identity),
          agentId: draft.agentId ? String(draft.agentId) : null,
          status: parseDraftStatus(draft.status),
          createdAt: String(draft.createdAt || ''),
          updatedAt: String(draft.updatedAt || ''),
          lastPublishedAt: draft.lastPublishedAt ? String(draft.lastPublishedAt) : null,
          lastPublishedPostId: draft.lastPublishedPostId ? String(draft.lastPublishedPostId) : null,
        }))
        .filter((draft) => Boolean(draft.id)),
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(state: PublishWorkspaceState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

export function listPublishChannels(): PublishChannel[] {
  const state = loadState();
  return [
    {
      id: 'INTERNAL_FEED',
      type: 'INTERNAL_FEED',
      label: 'Internal Feed',
      description: 'Publish as a standard creator post',
      enabled: state.settings.channels.INTERNAL_FEED.enabled,
    },
    {
      id: 'INTERNAL_AGENT_PROFILE',
      type: 'INTERNAL_AGENT_PROFILE',
      label: 'Agent Profile',
      description: 'Publish under a selected agent identity when available',
      enabled: state.settings.channels.INTERNAL_AGENT_PROFILE.enabled,
    },
  ];
}

export function getPublishSettings() {
  return loadState().settings;
}

export function updatePublishSettings(patch: {
  defaultIdentity?: PublishIdentity;
  defaultAgentId?: string | null;
  channels?: Partial<Record<PublishChannelId, { enabled: boolean }>>;
}) {
  const state = loadState();
  const next: PublishWorkspaceState = {
    ...state,
    settings: {
      ...state.settings,
      ...patch,
      channels: {
        INTERNAL_FEED: patch.channels?.INTERNAL_FEED
          ? { ...state.settings.channels.INTERNAL_FEED, ...patch.channels.INTERNAL_FEED }
          : state.settings.channels.INTERNAL_FEED,
        INTERNAL_AGENT_PROFILE: patch.channels?.INTERNAL_AGENT_PROFILE
          ? { ...state.settings.channels.INTERNAL_AGENT_PROFILE, ...patch.channels.INTERNAL_AGENT_PROFILE }
          : state.settings.channels.INTERNAL_AGENT_PROFILE,
      },
    },
  };
  saveState(next);
  return next.settings;
}

export function listPublishDrafts(status?: string): PublishDraft[] {
  const drafts = loadState().drafts
    .slice()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (!status || status === 'ALL') return drafts;
  return drafts.filter((draft) => draft.status === status);
}

export function getPublishDraft(draftId: string): PublishDraft | null {
  return loadState().drafts.find((draft) => draft.id === draftId) || null;
}

export function createPublishDraft(
  payload: Partial<PublishDraft> & {
    tags?: string[];
    attachments?: PublishDraftAttachment[];
  },
): PublishDraft {
  const state = loadState();
  const createdAt = nowIso();
  const draft: PublishDraft = {
    id: createId(),
    title: String(payload.title || '').trim(),
    caption: String(payload.caption || ''),
    tags: Array.isArray(payload.tags) ? payload.tags.filter(Boolean) : [],
    attachments: Array.isArray(payload.attachments)
      ? payload.attachments
          .map((item) => normalizeAttachment(item))
          .filter((item): item is PublishDraftAttachment => item !== null)
      : [],
    identity: payload.identity === 'AGENT' ? 'AGENT' : state.settings.defaultIdentity,
    agentId: payload.agentId ? String(payload.agentId) : state.settings.defaultAgentId,
    status: 'DRAFT',
    createdAt,
    updatedAt: createdAt,
    lastPublishedAt: null,
    lastPublishedPostId: null,
  };
  const next = { ...state, drafts: [draft, ...state.drafts] };
  saveState(next);
  return draft;
}

export function updatePublishDraft(
  draftId: string,
  payload: Partial<PublishDraft> & {
    tags?: string[];
    attachments?: PublishDraftAttachment[];
  },
): PublishDraft {
  const state = loadState();
  const current = state.drafts.find((draft) => draft.id === draftId);
  if (!current) {
    throw new Error('Publish draft not found');
  }
  const nextDraft: PublishDraft = {
    ...current,
    ...payload,
    title: payload.title !== undefined ? String(payload.title || '').trim() : current.title,
    caption: payload.caption !== undefined ? String(payload.caption || '') : current.caption,
    tags: payload.tags ? payload.tags.filter(Boolean) : current.tags,
    attachments: payload.attachments
      ? payload.attachments
          .map((item) => normalizeAttachment(item))
          .filter((item): item is PublishDraftAttachment => item !== null)
      : current.attachments,
    identity: payload.identity ? (payload.identity === 'AGENT' ? 'AGENT' : 'USER') : current.identity,
    agentId: payload.agentId !== undefined ? (payload.agentId ? String(payload.agentId) : null) : current.agentId,
    updatedAt: nowIso(),
  };
  const next = {
    ...state,
    drafts: state.drafts.map((draft) => (draft.id === draftId ? nextDraft : draft)),
  };
  saveState(next);
  return nextDraft;
}

export function deletePublishDraft(draftId: string) {
  const state = loadState();
  const next = { ...state, drafts: state.drafts.filter((draft) => draft.id !== draftId) };
  saveState(next);
}

export function markPublishDraftPublished(draftId: string, postId: string): PublishDraft {
  const state = loadState();
  const current = state.drafts.find((draft) => draft.id === draftId);
  if (!current) {
    throw new Error('Publish draft not found');
  }
  const publishedAt = nowIso();
  const nextDraft: PublishDraft = {
    ...current,
    status: 'PUBLISHED',
    updatedAt: publishedAt,
    lastPublishedAt: publishedAt,
    lastPublishedPostId: postId,
  };
  const next = {
    ...state,
    drafts: state.drafts.map((draft) => (draft.id === draftId ? nextDraft : draft)),
  };
  saveState(next);
  return nextDraft;
}

export function listPublishDeliveries(draftId: string) {
  const state = loadState();
  const draft = state.drafts.find((item) => item.id === draftId);
  if (!draft) {
    return [];
  }
  return listPublishChannels()
    .filter((channel) => channel.enabled)
    .map((channel) => ({
      channelId: channel.id,
      status: draft.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
      publishedPostId: draft.lastPublishedPostId,
      publishedAt: draft.lastPublishedAt,
    }));
}
