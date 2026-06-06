import type {
  AddGroupAgentInputDto,
  ChatSyncResultDto,
  CommitRealmGroupMessageCandidateInputDto,
  CreateGroupInputDto,
  GroupChatViewDto,
  GroupMessageViewDto,
  GroupParticipantDto,
  ListGroupChatsResultDto,
  ListGroupMessagesResultDto,
  MessageType,
  RealmGroupMessageCandidateCommitResultDto,
  RealmTypedCallOptions,
  RealmTypedClient,
  SendMessageInputDto,
} from '../core-generated/realm-typed-client';
import { createNimiError, type JsonObject } from '../types';

export type NimiRealmGroupChatView = GroupChatViewDto;
export type NimiRealmGroupMessageView = GroupMessageViewDto;
export type NimiRealmGroupParticipant = GroupParticipantDto;
export type NimiRealmGroupChatListResult = ListGroupChatsResultDto;
export type NimiRealmGroupMessageListResult = ListGroupMessagesResultDto;
export type NimiRealmGroupMessageCandidateCommitInput = CommitRealmGroupMessageCandidateInputDto;
export type NimiRealmGroupMessageCandidateCommitResult = RealmGroupMessageCandidateCommitResultDto;
export type NimiRealmGroupCreateInput = CreateGroupInputDto;
export type NimiRealmGroupSendMessageInput = SendMessageInputDto;
export type NimiRealmGroupChatSyncResult = ChatSyncResultDto;
export type NimiRealmGroupMessageType = MessageType;

export interface NimiRealmGroupChatApi {
  readonly groupChat: Pick<
    RealmTypedClient,
    | 'addGroupAgent'
    | 'commitRealmGroupMessageCandidate'
    | 'createGroup'
    | 'getGroup'
    | 'listGroupMessages'
    | 'listGroups'
    | 'markGroupRead'
    | 'removeGroupAgent'
    | 'sendGroupMessage'
    | 'syncGroupEvents'
  >;
}

function normalizeString(value: unknown): string {
  return String(value || '').trim();
}

function fail(input: {
  readonly reasonCode: string;
  readonly message: string;
  readonly actionHint: string;
  readonly details?: JsonObject;
}): never {
  throw createNimiError({
    message: input.message,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: 'realm',
    details: input.details,
  });
}

function requireRealmGroupChatId(chatId: unknown): string {
  const normalized = normalizeString(chatId);
  if (!normalized) {
    fail({
      reasonCode: 'SDK_REALM_GROUP_CHAT_ID_REQUIRED',
      message: 'Realm group chat id is required.',
      actionHint: 'provide_realm_group_chat_id',
    });
  }
  return normalized;
}

function normalizeLimit(limit: unknown, fallback: number, max: number): number {
  return typeof limit === 'number' && Number.isFinite(limit)
    ? Math.min(max, Math.max(1, Math.floor(limit)))
    : fallback;
}

function normalizeAfterSeq(afterSeq: unknown): number {
  return typeof afterSeq === 'number' && Number.isFinite(afterSeq)
    ? Math.max(0, Math.floor(afterSeq))
    : 0;
}

function requireAgentAccountId(agentAccountId: unknown): string {
  const normalized = normalizeString(agentAccountId);
  if (!normalized) {
    fail({
      reasonCode: 'SDK_REALM_GROUP_AGENT_ACCOUNT_ID_REQUIRED',
      message: 'Realm group agent account id is required.',
      actionHint: 'provide_realm_group_agent_account_id',
    });
  }
  return normalized;
}

export function createNimiRealmGroupTextMessageInput(
  content: unknown,
  clientMessageId: unknown,
): NimiRealmGroupSendMessageInput {
  const normalizedContent = normalizeString(content);
  const normalizedClientMessageId = normalizeString(clientMessageId);
  if (!normalizedContent) {
    fail({
      reasonCode: 'SDK_REALM_GROUP_MESSAGE_TEXT_REQUIRED',
      message: 'Realm group text message content is required.',
      actionHint: 'provide_realm_group_message_text',
    });
  }
  if (!normalizedClientMessageId) {
    fail({
      reasonCode: 'SDK_REALM_GROUP_MESSAGE_CLIENT_ID_REQUIRED',
      message: 'Realm group message client id is required.',
      actionHint: 'provide_realm_group_message_client_id',
    });
  }
  return {
    clientMessageId: normalizedClientMessageId,
    type: 'TEXT' as NimiRealmGroupMessageType,
    text: normalizedContent,
    payload: { content: normalizedContent },
  };
}

export async function listNimiRealmGroupChats(
  realm: NimiRealmGroupChatApi,
  limit = 20,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmGroupChatListResult> {
  return realm.groupChat.listGroups({
    path: {},
    query: { limit: normalizeLimit(limit, 20, 100) },
  }, options);
}

export async function loadNimiRealmGroupChat(
  realm: NimiRealmGroupChatApi,
  chatId: unknown,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmGroupChatView> {
  return realm.groupChat.getGroup({
    path: { chatId: requireRealmGroupChatId(chatId) },
  }, options);
}

export async function loadNimiRealmGroupMessages(
  realm: NimiRealmGroupChatApi,
  chatId: unknown,
  limit = 50,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmGroupMessageListResult> {
  return realm.groupChat.listGroupMessages({
    path: { chatId: requireRealmGroupChatId(chatId) },
    query: { limit: normalizeLimit(limit, 50, 100) },
  }, options);
}

export async function sendNimiRealmGroupMessage(
  realm: NimiRealmGroupChatApi,
  chatId: unknown,
  input: NimiRealmGroupSendMessageInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmGroupMessageView> {
  return realm.groupChat.sendGroupMessage({
    path: { chatId: requireRealmGroupChatId(chatId) },
    body: input,
  }, options);
}

export async function commitNimiRealmGroupMessageCandidate(
  realm: NimiRealmGroupChatApi,
  chatId: unknown,
  input: NimiRealmGroupMessageCandidateCommitInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmGroupMessageCandidateCommitResult> {
  return realm.groupChat.commitRealmGroupMessageCandidate({
    path: { chatId: requireRealmGroupChatId(chatId) },
    body: input,
  }, options);
}

export async function markNimiRealmGroupRead(
  realm: NimiRealmGroupChatApi,
  chatId: unknown,
  options?: RealmTypedCallOptions,
): Promise<void> {
  await realm.groupChat.markGroupRead({
    path: { chatId: requireRealmGroupChatId(chatId) },
  }, options);
}

export async function createNimiRealmGroupChat(
  realm: NimiRealmGroupChatApi,
  input: NimiRealmGroupCreateInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmGroupChatView> {
  return realm.groupChat.createGroup({
    path: {},
    body: input,
  }, options);
}

export async function addNimiRealmGroupAgent(
  realm: NimiRealmGroupChatApi,
  chatId: unknown,
  agentAccountId: unknown,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmGroupParticipant> {
  const body: AddGroupAgentInputDto = {
    agentAccountId: requireAgentAccountId(agentAccountId),
  };
  return realm.groupChat.addGroupAgent({
    path: { chatId: requireRealmGroupChatId(chatId) },
    body,
  }, options);
}

export async function removeNimiRealmGroupAgent(
  realm: NimiRealmGroupChatApi,
  chatId: unknown,
  agentAccountId: unknown,
  options?: RealmTypedCallOptions,
): Promise<void> {
  const normalizedAgentAccountId = requireAgentAccountId(agentAccountId);
  await realm.groupChat.removeGroupAgent({
    path: {
      chatId: requireRealmGroupChatId(chatId),
      agentAccountId: normalizedAgentAccountId,
    },
  }, options);
}

export async function syncNimiRealmGroupEvents(
  realm: NimiRealmGroupChatApi,
  chatId: unknown,
  afterSeq: unknown,
  limit = 200,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmGroupChatSyncResult> {
  return realm.groupChat.syncGroupEvents({
    path: { chatId: requireRealmGroupChatId(chatId) },
    query: {
      limit: normalizeLimit(limit, 200, 500),
      afterSeq: normalizeAfterSeq(afterSeq),
    },
  }, options);
}
