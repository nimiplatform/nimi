import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';
import type {
  ListLocalAppAgentReferencesRequest,
  ListLocalAppAgentReferencesResponse,
} from '../../core-generated/runtime-protobuf/runtime/v1/agent_service.js';
import {
  asRecord,
  assertExactProjectionKeys,
  localAppProjectionError,
  projectionText,
} from './local-app-runtime-platform-validation.js';

export type NimiLocalAppAgentReference = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly displayName: string;
  readonly avatarUrl: string | null;
};

export type NimiLocalAppAgentReferencesShell = {
  readonly listReferences: () => Promise<unknown>;
};

export type NimiLocalAppAgentReferencesClient = {
  readonly listReferences: () => Promise<readonly NimiLocalAppAgentReference[]>;
};

export type NimiLocalAppAgentReferencesRuntime = {
  readonly listLocalAppAgentReferences: (
    request: ListLocalAppAgentReferencesRequest,
  ) => Promise<ListLocalAppAgentReferencesResponse>;
};

export function createNimiLocalAppAgentReferencesClient(
  shell: NimiLocalAppAgentReferencesShell,
): NimiLocalAppAgentReferencesClient {
  return Object.freeze({
    listReferences: async () => {
      const value = await shell.listReferences();
      if (!Array.isArray(value)) localAppProjectionError('Agent reference list');
      const handles = new Set<string>();
      return Object.freeze(value.map((entry) => {
        const record = asRecord(entry);
        assertExactProjectionKeys(record, ['agentHandle', 'displayName', 'avatarUrl'], 'Agent reference');
        const agentHandle = projectionText(record.agentHandle, 'Agent reference agentHandle');
        if (!/^agent_ref_[A-Za-z0-9_-]{43}$/u.test(agentHandle) || handles.has(agentHandle)) {
          localAppProjectionError('Agent reference agentHandle');
        }
        handles.add(agentHandle);
        const displayName = boundedDisplayName(record.displayName);
        const avatarUrl = record.avatarUrl;
        if (avatarUrl !== null && !safeAgentAvatarUrl(avatarUrl)) {
          localAppProjectionError('Agent reference avatarUrl');
        }
        return Object.freeze({
          agentHandle: agentHandle as NimiLocalAppAgentHandle,
          displayName,
          avatarUrl: avatarUrl as string | null,
        });
      }));
    },
  });
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r185
export function createNimiLocalAppAgentReferencesRuntimeClient(
  runtime: NimiLocalAppAgentReferencesRuntime,
): NimiLocalAppAgentReferencesClient {
  return createNimiLocalAppAgentReferencesClient({
    listReferences: async () => {
      const response = await runtime.listLocalAppAgentReferences({});
      return response.references.map((reference) => ({
        agentHandle: reference.agentHandle,
        displayName: reference.displayName,
        avatarUrl: reference.avatarUrl ?? null,
      }));
    },
  });
}

function boundedDisplayName(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value
    || new TextEncoder().encode(value).byteLength > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    localAppProjectionError('Agent reference displayName');
  }
  return value;
}

function safeAgentAvatarUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.username === ''
      && parsed.password === ''
      && parsed.search === ''
      && parsed.hash === ''
      && (parsed.port === '' || parsed.port === '443')
      && parsed.hostname !== 'localhost'
      && !parsed.hostname.endsWith('.localhost')
      && !parsed.hostname.endsWith('.local')
      && !parsed.hostname.endsWith('.internal')
      && !/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(parsed.hostname)
      && !parsed.hostname.includes(':');
  } catch {
    return false;
  }
}
