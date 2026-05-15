import type { Runtime } from '@nimiplatform/sdk/runtime/browser';

const STORAGE_KEY = 'nimi.avatar.conversation-context.v2';
const SCHEMA_VERSION = 2;

type PersistedConversationContext = {
  schemaVersion: 2;
  accountId: string;
  localAgentRef: string;
  avatarInstanceId: string;
  conversationAnchorId: string;
  updatedAtMs: number;
};

type PersistedConversationContextFile = {
  schemaVersion: 2;
  records: PersistedConversationContext[];
};

export type AvatarConversationContextResult = {
  conversationAnchorId: string;
  subjectUserId: string;
  recovered: boolean;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function annotateConversationContextError(stage: string, error: unknown): never {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.avatarBootstrapStage !== 'string' || !record.avatarBootstrapStage.trim()) {
      record.avatarBootstrapStage = stage;
    }
    throw error;
  }
  const wrapped = new Error(String(error || 'avatar_conversation_context_unavailable')) as Error & {
    avatarBootstrapStage?: string;
  };
  wrapped.avatarBootstrapStage = stage;
  throw wrapped;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function contextKey(input: {
  accountId: string;
  localAgentRef: string;
  avatarInstanceId: string;
}): string {
  return `${input.accountId}\u001f${input.localAgentRef}\u001f${input.avatarInstanceId}`;
}

function readPersistedFile(): PersistedConversationContextFile {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) {
    return { schemaVersion: SCHEMA_VERSION, records: [] };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedConversationContextFile>;
    if (parsed?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.records)) {
      return { schemaVersion: SCHEMA_VERSION, records: [] };
    }
    const records = parsed.records.filter((record): record is PersistedConversationContext => (
      record?.schemaVersion === SCHEMA_VERSION
      && Boolean(normalizeText(record.accountId))
      && Boolean(normalizeText(record.localAgentRef))
      && Boolean(normalizeText(record.avatarInstanceId))
      && Boolean(normalizeText(record.conversationAnchorId))
      && typeof record.updatedAtMs === 'number'
      && Number.isFinite(record.updatedAtMs)
    ));
    return { schemaVersion: SCHEMA_VERSION, records };
  } catch {
    return { schemaVersion: SCHEMA_VERSION, records: [] };
  }
}

function writePersistedFile(file: PersistedConversationContextFile): void {
  const target = storage();
  if (!target) {
    return;
  }
  target.setItem(STORAGE_KEY, JSON.stringify(file));
}

function readPersistedContext(input: {
  accountId: string;
  localAgentRef: string;
  avatarInstanceId: string;
}): PersistedConversationContext | null {
  const key = contextKey(input);
  return readPersistedFile().records.find((record) => contextKey(record) === key) ?? null;
}

function writePersistedContext(input: {
  accountId: string;
  localAgentRef: string;
  avatarInstanceId: string;
  conversationAnchorId: string;
  nowMs?: number;
}): void {
  const key = contextKey(input);
  const file = readPersistedFile();
  const nextRecord: PersistedConversationContext = {
    schemaVersion: SCHEMA_VERSION,
    accountId: input.accountId,
    localAgentRef: input.localAgentRef,
    avatarInstanceId: input.avatarInstanceId,
    conversationAnchorId: input.conversationAnchorId,
    updatedAtMs: input.nowMs ?? Date.now(),
  };
  writePersistedFile({
    schemaVersion: SCHEMA_VERSION,
    records: [
      nextRecord,
      ...file.records.filter((record) => contextKey(record) !== key),
    ].slice(0, 128),
  });
}

function forgetPersistedContext(input: {
  accountId: string;
  localAgentRef: string;
  avatarInstanceId: string;
}): void {
  const key = contextKey(input);
  const file = readPersistedFile();
  writePersistedFile({
    schemaVersion: SCHEMA_VERSION,
    records: file.records.filter((record) => contextKey(record) !== key),
  });
}

async function validatePersistedAnchor(input: {
  runtime: Runtime;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  conversationAnchorId: string;
}): Promise<AvatarConversationContextResult | null> {
  try {
    const snapshot = await input.runtime.agent.anchors.getSnapshot({
      ownerUserId: input.ownerUserId,
      realmAgentId: input.realmAgentId,
      localAgentRef: input.localAgentRef,
      conversationAnchorId: input.conversationAnchorId,
    });
    const anchor = snapshot.anchor;
    const conversationAnchorId = normalizeText(anchor?.conversationAnchorId);
    const anchorAgentId = normalizeText(anchor?.agentId);
    const subjectUserId = normalizeText(anchor?.subjectUserId);
    if (
      conversationAnchorId !== input.conversationAnchorId
      || anchorAgentId !== input.localAgentRef
      || subjectUserId !== input.ownerUserId
    ) {
      return null;
    }
    return {
      conversationAnchorId,
      subjectUserId,
      recovered: true,
    };
  } catch {
    return null;
  }
}

export async function resolveAvatarConversationContext(input: {
  runtime: Runtime;
  accountId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  avatarInstanceId: string;
  launchSource: string | null;
}): Promise<AvatarConversationContextResult> {
  if (input.accountId !== input.ownerUserId) {
    throw new Error('Avatar launch ownerUserId does not match Runtime account projection');
  }
  const persisted = readPersistedContext(input);
  if (persisted) {
    const recovered = await validatePersistedAnchor({
      runtime: input.runtime,
      ownerUserId: input.ownerUserId,
      realmAgentId: input.realmAgentId,
      localAgentRef: input.localAgentRef,
      conversationAnchorId: persisted.conversationAnchorId,
    });
    if (recovered) {
      return recovered;
    }
    forgetPersistedContext(input);
  }

  try {
    const snapshot = await input.runtime.agent.anchors.open({
      ownerUserId: input.ownerUserId,
      realmAgentId: input.realmAgentId,
      localAgentRef: input.localAgentRef,
      metadata: {
        launch_source: input.launchSource,
        avatar_instance_id: input.avatarInstanceId,
        surface: 'avatar-first-party',
      },
    });
    const anchor = snapshot.anchor;
    const conversationAnchorId = normalizeText(anchor?.conversationAnchorId);
    const anchorAgentId = normalizeText(anchor?.agentId);
    const subjectUserId = normalizeText(anchor?.subjectUserId);
    if (!conversationAnchorId) {
      throw new Error('Runtime did not return an Avatar conversation anchor');
    }
    if (anchorAgentId !== input.localAgentRef) {
      throw new Error('Runtime returned an Avatar conversation anchor for a different agent');
    }
    if (subjectUserId !== input.ownerUserId) {
      throw new Error('Runtime returned an Avatar conversation anchor for a different account');
    }
    writePersistedContext({
      accountId: input.accountId,
      localAgentRef: input.localAgentRef,
      avatarInstanceId: input.avatarInstanceId,
      conversationAnchorId,
    });
    return {
      conversationAnchorId,
      subjectUserId,
      recovered: false,
    };
  } catch (error) {
    annotateConversationContextError('conversation_anchor_open', error);
  }
}
