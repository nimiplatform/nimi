import type { Realm } from '../client.js';
import type { RealmModel } from '../generated/type-helpers.js';

export type RealmGroupChatViewDto = RealmModel<'GroupChatViewDto'>;
export type RealmGroupMessageViewDto = RealmModel<'GroupMessageViewDto'>;
export type RealmGroupParticipantDto = RealmModel<'GroupParticipantDto'>;
export type RealmGroupChatListResultDto = RealmModel<'ListGroupChatsResultDto'>;
export type RealmGroupMessageListResultDto = RealmModel<'ListGroupMessagesResultDto'>;
export type RealmGroupMessageCandidateCommitInputDto = RealmModel<'CommitRealmGroupMessageCandidateInputDto'>;
export type RealmGroupMessageCandidateCommitResultDto = RealmModel<'RealmGroupMessageCandidateCommitResultDto'>;
export type RealmGroupCreateInputDto = RealmModel<'CreateGroupInputDto'>;
export type RealmGroupSendMessageInputDto = RealmModel<'SendMessageInputDto'>;
export type RealmGroupChatSyncResultDto = RealmModel<'ChatSyncResultDto'>;
export type RealmGroupMessageType = RealmModel<'MessageType'>;

function normalizeString(value: unknown): string {
  return String(value || '').trim();
}

function requireRealmGroupChatId(chatId: string): string {
  const normalized = normalizeString(chatId);
  if (!normalized) {
    throw new Error('REALM_GROUP_CHAT_ID_REQUIRED');
  }
  return normalized;
}

function normalizeLimit(limit: number, fallback: number, max: number): number {
  return Number.isFinite(limit) ? Math.min(max, Math.max(1, Math.floor(limit))) : fallback;
}

function normalizeAfterSeq(afterSeq: number): number {
  return Number.isFinite(afterSeq) ? Math.max(0, Math.floor(afterSeq)) : 0;
}

export function createRealmGroupTextMessageInput(
  content: string,
  clientMessageId: string,
): RealmGroupSendMessageInputDto {
  const normalizedContent = normalizeString(content);
  const normalizedClientMessageId = normalizeString(clientMessageId);
  if (!normalizedContent) {
    throw new Error('REALM_GROUP_MESSAGE_TEXT_REQUIRED');
  }
  if (!normalizedClientMessageId) {
    throw new Error('REALM_GROUP_MESSAGE_CLIENT_ID_REQUIRED');
  }
  return {
    clientMessageId: normalizedClientMessageId,
    type: 'TEXT' as RealmGroupMessageType,
    text: normalizedContent,
    payload: { content: normalizedContent },
  };
}

export async function listRealmGroupChats(
  realm: Pick<Realm, 'services'>,
  limit = 20,
): Promise<RealmGroupChatListResultDto> {
  return realm.services.GroupChatsService.listGroups(normalizeLimit(limit, 20, 100));
}

export async function loadRealmGroupChat(
  realm: Pick<Realm, 'services'>,
  chatId: string,
): Promise<RealmGroupChatViewDto> {
  return realm.services.GroupChatsService.getGroup(requireRealmGroupChatId(chatId));
}

export async function loadRealmGroupMessages(
  realm: Pick<Realm, 'services'>,
  chatId: string,
  limit = 50,
): Promise<RealmGroupMessageListResultDto> {
  return realm.services.GroupChatsService.listGroupMessages(
    requireRealmGroupChatId(chatId),
    normalizeLimit(limit, 50, 100),
  );
}

export async function sendRealmGroupMessage(
  realm: Pick<Realm, 'services'>,
  chatId: string,
  input: RealmGroupSendMessageInputDto,
): Promise<RealmGroupMessageViewDto> {
  return realm.services.GroupChatsService.sendGroupMessage(requireRealmGroupChatId(chatId), input);
}

export async function commitRealmGroupMessageCandidate(
  realm: Pick<Realm, 'services'>,
  chatId: string,
  input: RealmGroupMessageCandidateCommitInputDto,
): Promise<RealmGroupMessageCandidateCommitResultDto> {
  return realm.services.GroupChatsService.commitRealmGroupMessageCandidate(
    requireRealmGroupChatId(chatId),
    input,
  );
}

export async function markRealmGroupRead(
  realm: Pick<Realm, 'services'>,
  chatId: string,
): Promise<void> {
  await realm.services.GroupChatsService.markGroupRead(requireRealmGroupChatId(chatId));
}

export async function createRealmGroupChat(
  realm: Pick<Realm, 'services'>,
  input: RealmGroupCreateInputDto,
): Promise<RealmGroupChatViewDto> {
  return realm.services.GroupChatsService.createGroup(input);
}

export async function addRealmGroupAgent(
  realm: Pick<Realm, 'services'>,
  chatId: string,
  agentAccountId: string,
): Promise<RealmGroupParticipantDto> {
  const normalizedAgentAccountId = normalizeString(agentAccountId);
  if (!normalizedAgentAccountId) {
    throw new Error('REALM_GROUP_AGENT_ACCOUNT_ID_REQUIRED');
  }
  return realm.services.GroupChatsService.addGroupAgent(
    requireRealmGroupChatId(chatId),
    { agentAccountId: normalizedAgentAccountId },
  );
}

export async function removeRealmGroupAgent(
  realm: Pick<Realm, 'services'>,
  chatId: string,
  agentAccountId: string,
): Promise<void> {
  const normalizedAgentAccountId = normalizeString(agentAccountId);
  if (!normalizedAgentAccountId) {
    throw new Error('REALM_GROUP_AGENT_ACCOUNT_ID_REQUIRED');
  }
  await realm.services.GroupChatsService.removeGroupAgent(
    requireRealmGroupChatId(chatId),
    normalizedAgentAccountId,
  );
}

export async function syncRealmGroupEvents(
  realm: Pick<Realm, 'services'>,
  chatId: string,
  afterSeq: number,
  limit = 200,
): Promise<RealmGroupChatSyncResultDto> {
  return realm.services.GroupChatsService.syncGroupEvents(
    requireRealmGroupChatId(chatId),
    normalizeLimit(limit, 200, 500),
    normalizeAfterSeq(afterSeq),
  );
}
