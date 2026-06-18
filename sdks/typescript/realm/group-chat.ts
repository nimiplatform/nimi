import type {
  AddGroupParticipantInputDto,
  AddGroupSourceParticipantInputDto,
  ChatSyncResultDto,
  CommitRealmGroupSourceMessageCandidateInputDto,
  CreateGroupInputDto,
  GroupSourceRefDto,
  GroupChatViewDto,
  GroupMessageViewDto,
  GroupParticipantDto,
  ListGroupChatsResultDto,
  ListGroupMessagesResultDto,
  MessageType,
  RealmTypedCallOptions,
  RealmTypedClient,
  SendMessageInputDto,
  RealmGroupMessageCandidateCommitResultDto,
  UpdateGroupInputDto,
  UpdateParticipantRoleInputDto,
} from '../core-generated/realm-typed-client';
import { createNimiError, type JsonObject } from '../types';

export type NimiRealmGroupChatView = GroupChatViewDto;
export type NimiRealmGroupMessageView = GroupMessageViewDto;
export type NimiRealmGroupParticipant = GroupParticipantDto;
export type NimiRealmGroupChatListResult = ListGroupChatsResultDto;
export type NimiRealmGroupMessageListResult = ListGroupMessagesResultDto;
export type NimiRealmGroupCreateInput = CreateGroupInputDto;
export type NimiRealmGroupUpdateInput = UpdateGroupInputDto;
export type NimiRealmGroupParticipantRoleInput = UpdateParticipantRoleInputDto;
export type NimiRealmGroupSendMessageInput = SendMessageInputDto;
export type NimiRealmGroupChatSyncResult = ChatSyncResultDto;
export type NimiRealmGroupMessageType = MessageType;
export type NimiRealmGroupSourceRef = GroupSourceRefDto;
export type NimiRealmGroupSourceParticipantInput = AddGroupSourceParticipantInputDto;
export type NimiRealmGroupMessageCandidateCommitInput = CommitRealmGroupSourceMessageCandidateInputDto;
export type NimiRealmGroupMessageCandidateCommitResult = RealmGroupMessageCandidateCommitResultDto;

export interface NimiRealmGroupChatApi {
  readonly groupChat: Pick<
    RealmTypedClient,
    | 'addGroupParticipant'
    | 'addGroupSourceParticipant'
    | 'commitRealmGroupSourceMessageCandidate'
    | 'createGroup'
    | 'editGroupMessage'
    | 'getGroup'
    | 'listGroupMessages'
    | 'listGroups'
    | 'markGroupRead'
    | 'recallGroupMessage'
    | 'removeGroupParticipant'
    | 'removeGroupSourceParticipant'
    | 'sendGroupMessage'
    | 'syncGroupEvents'
    | 'updateGroup'
    | 'updateGroupParticipantRole'
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

function requireAccountId(accountId: unknown): string {
  const normalized = normalizeString(accountId);
  if (!normalized) {
    fail({
      reasonCode: 'SDK_REALM_GROUP_ACCOUNT_ID_REQUIRED',
      message: 'Realm group participant account id is required.',
      actionHint: 'provide_realm_group_account_id',
    });
  }
  return normalized;
}

function requireRuntimeParticipantSlot(runtimeParticipantSlot: unknown): string {
  const normalized = normalizeString(runtimeParticipantSlot);
  if (!normalized) {
    fail({
      reasonCode: 'SDK_REALM_GROUP_RUNTIME_PARTICIPANT_SLOT_REQUIRED',
      message: 'Realm group runtime participant slot id is required.',
      actionHint: 'provide_runtime_participant_slot',
    });
  }
  return normalized;
}

function requireMessageId(messageId: unknown): string {
  const normalized = normalizeString(messageId);
  if (!normalized) {
    fail({
      reasonCode: 'SDK_REALM_GROUP_MESSAGE_ID_REQUIRED',
      message: 'Realm group message id is required.',
      actionHint: 'provide_realm_group_message_id',
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

export async function editNimiRealmGroupMessage(
  realm: NimiRealmGroupChatApi,
  chatId: unknown,
  messageId: unknown,
  text: unknown,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmGroupMessageView> {
  const normalizedText = normalizeString(text);
  if (!normalizedText) {
    fail({
      reasonCode: 'SDK_REALM_GROUP_MESSAGE_TEXT_REQUIRED',
      message: 'Realm group text message content is required.',
      actionHint: 'provide_realm_group_message_text',
    });
  }
  return realm.groupChat.editGroupMessage({
    path: {
      chatId: requireRealmGroupChatId(chatId),
      messageId: requireMessageId(messageId),
    },
    body: { text: normalizedText },
  }, options);
}

export async function recallNimiRealmGroupMessage(
  realm: NimiRealmGroupChatApi,
  chatId: unknown,
  messageId: unknown,
  options?: RealmTypedCallOptions,
): Promise<void> {
  await realm.groupChat.recallGroupMessage({
    path: {
      chatId: requireRealmGroupChatId(chatId),
      messageId: requireMessageId(messageId),
    },
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

export async function updateNimiRealmGroupChat(
  realm: NimiRealmGroupChatApi,
  chatId: unknown,
  input: NimiRealmGroupUpdateInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmGroupChatView> {
  return realm.groupChat.updateGroup({
    path: { chatId: requireRealmGroupChatId(chatId) },
    body: input,
  }, options);
}

export async function addNimiRealmGroupParticipant(
  realm: NimiRealmGroupChatApi,
  chatId: unknown,
  accountId: unknown,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmGroupParticipant> {
  const body: AddGroupParticipantInputDto = {
    accountId: requireAccountId(accountId),
  };
  return realm.groupChat.addGroupParticipant({
    path: { chatId: requireRealmGroupChatId(chatId) },
    body,
  }, options);
}

export async function addNimiRealmGroupSourceParticipant(
  realm: NimiRealmGroupChatApi,
  chatId: unknown,
  input: NimiRealmGroupSourceParticipantInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmGroupParticipant> {
  return realm.groupChat.addGroupSourceParticipant({
    path: { chatId: requireRealmGroupChatId(chatId) },
    body: input,
  }, options);
}

export async function commitNimiRealmGroupSourceMessageCandidate(
  realm: NimiRealmGroupChatApi,
  chatId: unknown,
  input: NimiRealmGroupMessageCandidateCommitInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmGroupMessageCandidateCommitResult> {
  return realm.groupChat.commitRealmGroupSourceMessageCandidate({
    path: { chatId: requireRealmGroupChatId(chatId) },
    body: input,
  }, options);
}

export async function removeNimiRealmGroupParticipant(
  realm: NimiRealmGroupChatApi,
  chatId: unknown,
  accountId: unknown,
  options?: RealmTypedCallOptions,
): Promise<void> {
  await realm.groupChat.removeGroupParticipant({
    path: {
      chatId: requireRealmGroupChatId(chatId),
      accountId: requireAccountId(accountId),
    },
  }, options);
}

export async function removeNimiRealmGroupSourceParticipant(
  realm: NimiRealmGroupChatApi,
  chatId: unknown,
  runtimeParticipantSlot: unknown,
  options?: RealmTypedCallOptions,
): Promise<void> {
  await realm.groupChat.removeGroupSourceParticipant({
    path: {
      chatId: requireRealmGroupChatId(chatId),
      runtimeParticipantSlotId: requireRuntimeParticipantSlot(runtimeParticipantSlot),
    },
  }, options);
}

export async function updateNimiRealmGroupParticipantRole(
  realm: NimiRealmGroupChatApi,
  chatId: unknown,
  accountId: unknown,
  input: NimiRealmGroupParticipantRoleInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmGroupParticipant> {
  return realm.groupChat.updateGroupParticipantRole({
    path: {
      chatId: requireRealmGroupChatId(chatId),
      accountId: requireAccountId(accountId),
    },
    body: input,
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
