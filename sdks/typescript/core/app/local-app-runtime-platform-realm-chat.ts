import type {
  ListRealmChatsRequest,
  ListRealmChatsResponse,
} from '../../core-generated/runtime-protobuf/runtime/v1/realm_realtime.js';
import {
  projectDirectRealmChatMessage,
  projectDirectRealmChatUserSummary,
} from './local-app-runtime-platform-direct-realm-realtime.js';
import { projectRuntimeOptionalTimestamp, projectRuntimeTimestamp } from './local-app-runtime-platform-direct-realtime-shared.js';
import type {
  NimiRealmChatUserSummary,
  NimiRealmRealtimeMessage,
} from './local-app-runtime-platform-realm-realtime.js';
import {
  projectRealmChatMessage,
  projectRealmChatUserSummary,
} from './local-app-runtime-platform-realm-realtime.js';
import {
  asRecord,
  assertExactKeys,
  assertExactProjectionKeys,
  localAppProjectionError,
  projectTimestamp,
} from './local-app-runtime-platform-validation.js';

type NimiRealmTimestamp = { readonly seconds: string; readonly nanos: number };

export type NimiRealmChatListInput = {
  readonly cursor?: string;
  readonly limit?: number;
};

export type NimiRealmChatListItem = {
  readonly chatId: string;
  readonly otherUser: NimiRealmChatUserSummary;
  readonly lastMessage: NimiRealmRealtimeMessage | null;
  readonly unreadCount: number;
  readonly createdAt: NimiRealmTimestamp;
  readonly updatedAt: NimiRealmTimestamp;
  readonly lastMessageAt: NimiRealmTimestamp | null;
};

export type NimiRealmChatListPage = {
  readonly items: readonly NimiRealmChatListItem[];
  readonly nextCursor: string | null;
};

export type NimiRealmChatShell = {
  readonly list: (input?: NimiRealmChatListInput) => Promise<unknown>;
};

export type NimiRealmChatClient = {
  readonly list: (input?: NimiRealmChatListInput) => Promise<NimiRealmChatListPage>;
};

export type NimiRealmChatRuntime = {
  readonly listRealmChats: (request: ListRealmChatsRequest) => Promise<ListRealmChatsResponse>;
};

// @nimi-authority: rule.nimi.sdks.feature-clients.r107
// @nimi-authority: rule.nimi.sdks.realm-consumer.r048
export function createNimiRealmChatClient(shell: NimiRealmChatShell): NimiRealmChatClient {
  return Object.freeze({
    list: async (input = {}) => {
      assertExactKeys(input, ['cursor', 'limit'], 'Realm Chat list input');
      const cursor = projectCursor(input.cursor);
      const limit = projectLimit(input.limit);
      const record = requiredRecord(await shell.list({
        ...(cursor ? { cursor } : {}),
        ...(limit ? { limit } : {}),
      }), 'Realm Chat list');
      assertExactProjectionKeys(record, ['items', 'nextCursor'], 'Realm Chat list');
      if (!Array.isArray(record.items)) fail('Realm Chat list');
      return Object.freeze({
        items: Object.freeze(record.items.map(projectChatListItem)),
        nextCursor: projectCursor(record.nextCursor),
      });
    },
  });
}

export function createNimiRealmChatRuntimeClient(runtime: NimiRealmChatRuntime): NimiRealmChatClient {
  return createNimiRealmChatClient({
    list: async (input = {}) => {
      const response = await runtime.listRealmChats({
        cursor: input.cursor ?? '',
        limit: input.limit ?? 0,
      });
      return {
        items: response.items.map((item) => ({
          chatId: item.chatId,
          otherUser: item.otherUser ? projectDirectRealmChatUserSummary(item.otherUser) : null,
          lastMessage: item.lastMessage ? projectDirectRealmChatMessage(item.lastMessage) : null,
          unreadCount: item.unreadCount,
          createdAt: projectRuntimeTimestamp(item.createdAt),
          updatedAt: projectRuntimeTimestamp(item.updatedAt),
          lastMessageAt: projectRuntimeOptionalTimestamp(item.lastMessageAt),
        })),
        nextCursor: response.nextCursor || null,
      };
    },
  });
}

function projectChatListItem(value: unknown): NimiRealmChatListItem {
  const record = requiredRecord(value, 'Realm Chat list item');
  assertExactProjectionKeys(record, ['chatId','otherUser','lastMessage','unreadCount','createdAt','updatedAt','lastMessageAt'], 'Realm Chat list item');
  if (!Number.isSafeInteger(record.unreadCount) || (record.unreadCount as number) < 0) fail('Realm Chat list item');
  return Object.freeze({
    chatId: selector(record.chatId),
    otherUser: projectRealmChatUserSummary(record.otherUser),
    lastMessage: record.lastMessage === null ? null : projectRealmChatMessage(record.lastMessage),
    unreadCount: record.unreadCount as number,
    createdAt: requiredTimestamp(record.createdAt),
    updatedAt: requiredTimestamp(record.updatedAt),
    lastMessageAt: record.lastMessageAt === null ? null : requiredTimestamp(record.lastMessageAt),
  });
}

function projectLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 50) fail('Realm Chat list limit');
  return value as number;
}

function projectCursor(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim() !== value || value.length > 512) fail('Realm Chat list cursor');
  return value;
}

function requiredTimestamp(value: unknown): NimiRealmTimestamp {
  const timestamp = projectTimestamp(value, 'Realm Chat list timestamp');
  return timestamp ?? fail('Realm Chat list timestamp');
}

function selector(value: unknown): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > 512) fail('Realm Chat selector');
  return value;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  return asRecord(value) ?? fail(label);
}

function fail(label: string): never {
  return localAppProjectionError(`${label} projection is invalid.`);
}
