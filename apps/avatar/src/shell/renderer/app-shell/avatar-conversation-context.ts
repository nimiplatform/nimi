import {
  readStorageJsonFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
} from '@nimiplatform/kit/core/storage-json';
import type {
  NimiRuntimeAgentConsumeClient,
  NimiRuntimeAgentScopeRunner,
} from '@nimiplatform/sdk/runtime';
import type { RuntimeTypedCallOptions } from '@nimiplatform/sdk/runtime/generated';

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

function errorField(error: unknown, key: string): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function isMissingAvatarLiveInstanceBinding(error: unknown): boolean {
  const reasonCode = errorField(error, 'reasonCode') || errorField(error, 'code');
  if (reasonCode === 'RUNTIME_GRPC_NOT_FOUND') {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error || '');
  return message.toLowerCase().includes('avatar live instance binding not found');
}

function contextKey(input: {
  accountId: string;
  localAgentRef: string;
  avatarInstanceId: string;
}): string {
  return `${input.accountId}\u001f${input.localAgentRef}\u001f${input.avatarInstanceId}`;
}

function emptyPersistedFile(): PersistedConversationContextFile {
  return { schemaVersion: SCHEMA_VERSION, records: [] };
}

function normalizePersistedFile(value: unknown): PersistedConversationContextFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return emptyPersistedFile();
  }
  const parsed = value as Partial<PersistedConversationContextFile>;
  if (parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.records)) {
    return emptyPersistedFile();
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
}

function readPersistedFile(storage: Storage | null = resolveBrowserStorage('local')): PersistedConversationContextFile {
  const result = readStorageJsonFrom(
    storage,
    STORAGE_KEY,
    normalizePersistedFile,
  );
  if (result.state !== 'ready') {
    return emptyPersistedFile();
  }
  return result.value;
}

function writePersistedFile(
  file: PersistedConversationContextFile,
  storage: Storage | null = resolveBrowserStorage('local'),
): void {
  writeStorageJsonTo(storage, STORAGE_KEY, file);
}

function writePersistedContext(input: {
  accountId: string;
  localAgentRef: string;
  avatarInstanceId: string;
  conversationAnchorId: string;
  nowMs?: number;
}): void {
  const storage = resolveBrowserStorage('local');
  if (!storage) {
    return;
  }
  const key = contextKey(input);
  const file = readPersistedFile(storage);
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
  }, storage);
}

function readPersistedContext(input: {
  accountId: string;
  localAgentRef: string;
  avatarInstanceId: string;
}): PersistedConversationContext | null {
  const key = contextKey(input);
  return readPersistedFile().records.find((record) => contextKey(record) === key) ?? null;
}

async function validatePersistedAnchor(input: {
  runtimeAgent: NimiRuntimeAgentConsumeClient;
  withScopes?: NimiRuntimeAgentScopeRunner;
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  conversationAnchorId: string;
}): Promise<AvatarConversationContextResult | null> {
  try {
    const snapshot = await withRuntimeAgentScopes(
      input.withScopes,
      ['runtime.agent.read'],
      (options) => input.runtimeAgent.anchors.getSnapshot({
        ownerUserId: input.ownerUserId,
        runtimeSourceRef: input.runtimeSourceRef,
        localAgentRef: input.localAgentRef,
        conversationAnchorId: input.conversationAnchorId,
      }, options),
    );
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

async function resolveRegisteredLiveInstanceAnchor(input: {
  runtimeAgent: NimiRuntimeAgentConsumeClient;
  withScopes?: NimiRuntimeAgentScopeRunner;
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  avatarInstanceId: string;
}): Promise<AvatarConversationContextResult | null> {
  try {
    const result = await withRuntimeAgentScopes(
      input.withScopes,
      ['runtime.agent.read'],
      (options) => input.runtimeAgent.anchors.resolveAvatarLiveInstance({
        ownerUserId: input.ownerUserId,
        runtimeSourceRef: input.runtimeSourceRef,
        localAgentRef: input.localAgentRef,
        avatarInstanceId: input.avatarInstanceId,
      }, options),
    );
    const binding = result.binding;
    const snapshot = result.snapshot;
    const anchor = snapshot.anchor;
    const conversationAnchorId = normalizeText(anchor?.conversationAnchorId);
    const bindingConversationAnchorId = normalizeText(binding.conversationAnchorId);
    const bindingAvatarInstanceId = normalizeText(binding.avatarInstanceId);
    const anchorAgentId = normalizeText(anchor?.agentId);
    const subjectUserId = normalizeText(anchor?.subjectUserId);
    if (
      !conversationAnchorId
      || conversationAnchorId !== bindingConversationAnchorId
      || bindingAvatarInstanceId !== input.avatarInstanceId
      || anchorAgentId !== input.localAgentRef
      || normalizeText(binding.localAgentRef) !== input.localAgentRef
      || normalizeText(binding.ownerUserId) !== input.ownerUserId
      || normalizeText(binding.runtimeSourceRef) !== input.runtimeSourceRef
      || subjectUserId !== input.ownerUserId
    ) {
      return null;
    }
    return {
      conversationAnchorId,
      subjectUserId,
      recovered: true,
    };
  } catch (error) {
    if (!isMissingAvatarLiveInstanceBinding(error)) {
      throw error;
    }
    return null;
  }
}

export async function resolveAvatarConversationContext(input: {
  runtimeAgent: NimiRuntimeAgentConsumeClient;
  withScopes?: NimiRuntimeAgentScopeRunner;
  accountId: string;
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  avatarInstanceId: string;
}): Promise<AvatarConversationContextResult> {
  if (input.accountId !== input.ownerUserId) {
    throw new Error('Avatar resolved ownerUserId does not match Runtime account projection');
  }
  const registered = await resolveRegisteredLiveInstanceAnchor({
    runtimeAgent: input.runtimeAgent,
    withScopes: input.withScopes,
    ownerUserId: input.ownerUserId,
    runtimeSourceRef: input.runtimeSourceRef,
    localAgentRef: input.localAgentRef,
    avatarInstanceId: input.avatarInstanceId,
  });
  if (registered) {
    writePersistedContext({
      accountId: input.accountId,
      localAgentRef: input.localAgentRef,
      avatarInstanceId: input.avatarInstanceId,
      conversationAnchorId: registered.conversationAnchorId,
    });
    return registered;
  }

  const persisted = readPersistedContext({
    accountId: input.accountId,
    localAgentRef: input.localAgentRef,
    avatarInstanceId: input.avatarInstanceId,
  });
  if (persisted) {
    const recovered = await validatePersistedAnchor({
      runtimeAgent: input.runtimeAgent,
      withScopes: input.withScopes,
      ownerUserId: input.ownerUserId,
      runtimeSourceRef: input.runtimeSourceRef,
      localAgentRef: input.localAgentRef,
      conversationAnchorId: persisted.conversationAnchorId,
    });
    if (recovered) {
      writePersistedContext({
        accountId: input.accountId,
        localAgentRef: input.localAgentRef,
        avatarInstanceId: input.avatarInstanceId,
        conversationAnchorId: recovered.conversationAnchorId,
      });
      return recovered;
    }
  }

  const opened = await withRuntimeAgentScopes(
    input.withScopes,
    ['runtime.agent.write'],
    (options) => input.runtimeAgent.anchors.open({
      ownerUserId: input.ownerUserId,
      runtimeSourceRef: input.runtimeSourceRef,
      localAgentRef: input.localAgentRef,
    }, options),
  );
  const anchor = opened.anchor;
  const conversationAnchorId = normalizeText(anchor?.conversationAnchorId);
  const anchorAgentId = normalizeText(anchor?.agentId);
  const subjectUserId = normalizeText(anchor?.subjectUserId);
  if (
    !conversationAnchorId
    || anchorAgentId !== input.localAgentRef
    || subjectUserId !== input.ownerUserId
  ) {
    throw new Error('Runtime opened Avatar conversation anchor projection is invalid');
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
}

function withRuntimeAgentScopes<T>(
  runner: NimiRuntimeAgentScopeRunner | undefined,
  scopes: readonly string[],
  operation: (options?: RuntimeTypedCallOptions) => Promise<T>,
): Promise<T> {
  if (!runner) {
    return operation(undefined);
  }
  return runner(scopes, operation);
}
