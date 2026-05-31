import type { PasswordAuthDebug } from './auth';
import type { Realm } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { loginWithPassword, logoutWithCleanup, registerWithPassword } from './flows/auth-flow';
import {
  loadGroupChatList,
  loadGroupChat,
  loadGroupChatMessages,
  sendGroupChatMessage,
  commitRealmGroupMessageCandidateHandoff,
  markGroupChatRead,
  createGroupChat,
  syncGroupChatEvents,
  addGroupChatAgent,
  removeGroupChatAgent,
} from './flows/group-chat-flow';

type GroupMessageViewDto = RealmModel<'GroupMessageViewDto'>;
type GroupParticipantDto = RealmModel<'GroupParticipantDto'>;
import { createMasterAgent, loadCreatorAgents } from './flows/agent-flow';
import type { CreateMasterAgentInput } from './flows/social-flow';
import { loadExploreAgents, loadExploreFeedItems, loadMoreExploreFeedItems, type LoadExploreAgentsInput } from './flows/explore-flow';
import {
  loadAgentDetails,
} from './flows/agent-runtime-flow';
import {
  loadMainWorld,
  loadWorldDetailById,
  loadWorldHistory,
  loadWorldLevelAudits,
  loadWorldList,
  loadWorldLorebooks,
  loadWorldBindings,
  loadWorldScenes,
  loadWorldSemanticBundle,
  loadWorldAgents,
  loadWorldDetailWithAgents,
} from './flows/world-flow';
import {
  abandonWorldTransit,
  completeWorldTransit,
  getActiveWorldTransit,
  listWorldTransits,
  startWorldTransit,
  type TransitDetailDto,
  type TransitStatus,
  type TransitType,
} from './flows/transit-flow';
export type DataSyncCallApi = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
export type DataSyncEmitError = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

type CreateDataSyncActionsInput = {
  callApiTask: DataSyncCallApi;
  emitFacadeError: DataSyncEmitError;
  setToken: (token: string | null | undefined) => void;
  setRefreshToken: (token: string | null | undefined) => void;
  setAuth: (user: Record<string, unknown> | null | undefined, token: string, refreshToken?: string) => void;
  clearAuth: () => void;
  stopAllPolling: () => void;
  getCurrentUser: () => Record<string, unknown> | null;
};

export function createDataSyncActions(input: CreateDataSyncActionsInput) {
  return {
    loadGroupChats: async (limit = 20) =>
      loadGroupChatList(input.callApiTask, input.emitFacadeError, limit),
    loadGroupChat: async (chatId: string) =>
      loadGroupChat(input.callApiTask, input.emitFacadeError, chatId),
    loadGroupMessages: async (chatId: string, limit = 50) =>
      loadGroupChatMessages(input.callApiTask, input.emitFacadeError, chatId, limit),
    sendGroupMessage: async (chatId: string, content: string) =>
      sendGroupChatMessage(input.callApiTask, input.emitFacadeError, chatId, content),
    commitRealmGroupMessageCandidate: async (
      chatId: string,
      participant: GroupParticipantDto,
      triggerMessage: GroupMessageViewDto,
    ) =>
      commitRealmGroupMessageCandidateHandoff(
        input.callApiTask,
        input.emitFacadeError,
        input.getCurrentUser,
        chatId,
        participant,
        triggerMessage,
      ),
    markGroupRead: async (chatId: string) =>
      markGroupChatRead(input.callApiTask, input.emitFacadeError, chatId),
    createGroup: async (title: string, participantIds: string[], initialMessage?: string) =>
      createGroupChat(input.callApiTask, input.emitFacadeError, title, participantIds, initialMessage),
    syncGroupEvents: async (chatId: string, afterSeq: number, limit = 200) =>
      syncGroupChatEvents(input.callApiTask, input.emitFacadeError, chatId, afterSeq, limit),
    addGroupAgent: async (chatId: string, agentAccountId: string) =>
      addGroupChatAgent(input.callApiTask, input.emitFacadeError, chatId, agentAccountId),
    removeGroupAgent: async (chatId: string, agentAccountId: string) =>
      removeGroupChatAgent(input.callApiTask, input.emitFacadeError, chatId, agentAccountId),
    loadMyAgents: async () => loadCreatorAgents(input.callApiTask),
    createAgent: async (agentInput: CreateMasterAgentInput) =>
      createMasterAgent(input.callApiTask, agentInput),
    loadExploreAgents: async (agentInput: LoadExploreAgentsInput = {}) =>
      loadExploreAgents(input.callApiTask, input.emitFacadeError, agentInput),
    loadExploreFeed: async (tag: string | null = null, limit = 20) =>
      loadExploreFeedItems(input.callApiTask, input.emitFacadeError, tag, limit),
    loadMoreExploreFeed: async (limit = 20, cursor?: string, tag?: string | null) =>
      loadMoreExploreFeedItems(input.callApiTask, input.emitFacadeError, limit, cursor, tag),
    loadWorlds: async (status?: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED') =>
      loadWorldList(input.callApiTask, input.emitFacadeError, status),
    loadWorldDetailById: async (worldId: string) =>
      loadWorldDetailById(input.callApiTask, input.emitFacadeError, worldId),
    loadWorldSemanticBundle: async (worldId: string) =>
      loadWorldSemanticBundle(input.callApiTask, input.emitFacadeError, worldId),
    loadMainWorld: async () =>
      loadMainWorld(input.callApiTask, input.emitFacadeError),
    loadWorldLevelAudits: async (worldId: string, limit = 20) =>
      loadWorldLevelAudits(input.callApiTask, input.emitFacadeError, worldId, limit),
    loadWorldAgents: async (worldId: string) =>
      loadWorldAgents(input.callApiTask, input.emitFacadeError, worldId),
    loadWorldDetailWithAgents: async (worldId: string, recommendedAgentLimit?: number) =>
      loadWorldDetailWithAgents(input.callApiTask, input.emitFacadeError, worldId, recommendedAgentLimit),
    loadWorldHistory: async (worldId: string) =>
      loadWorldHistory(input.callApiTask, input.emitFacadeError, worldId),
    loadWorldLorebooks: async (worldId: string) =>
      loadWorldLorebooks(input.callApiTask, input.emitFacadeError, worldId),
    loadWorldBindings: async (worldId: string) =>
      loadWorldBindings(input.callApiTask, input.emitFacadeError, worldId),
    loadWorldScenes: async (worldId: string) =>
      loadWorldScenes(input.callApiTask, input.emitFacadeError, worldId),
    startWorldTransit: async (payload: {
      agentId: string;
      fromWorldId?: string;
      toWorldId: string;
      transitType: TransitType;
      reason?: string;
      context?: Record<string, unknown>;
    }): Promise<TransitDetailDto> =>
      startWorldTransit(input.callApiTask, input.emitFacadeError, payload),
    listWorldTransits: async (query?: {
      agentId?: string;
      status?: TransitStatus;
      transitType?: TransitType;
    }): Promise<TransitDetailDto[]> =>
      listWorldTransits(input.callApiTask, input.emitFacadeError, query),
    getActiveWorldTransit: async (agentId: string): Promise<TransitDetailDto | null> =>
      getActiveWorldTransit(input.callApiTask, input.emitFacadeError, agentId),
    completeWorldTransit: async (transitId: string): Promise<TransitDetailDto> =>
      completeWorldTransit(input.callApiTask, input.emitFacadeError, transitId),
    abandonWorldTransit: async (transitId: string): Promise<TransitDetailDto> =>
      abandonWorldTransit(input.callApiTask, input.emitFacadeError, transitId),
    loadAgentDetails: async (agentIdentifier: string) =>
      loadAgentDetails(input.callApiTask, input.emitFacadeError, agentIdentifier, {
        viewerUserId: String(input.getCurrentUser()?.id || '').trim() || undefined,
      }),
    login: async (identifier: string, password: string, debug?: PasswordAuthDebug) =>
      loginWithPassword(
        input.callApiTask,
        (token) => input.setToken(token),
        identifier,
        password,
        debug,
        (token) => input.setRefreshToken(token),
        (user, token, refreshToken) => input.setAuth(user, token, refreshToken),
      ),
    register: async (email: string, password: string, debug?: PasswordAuthDebug) =>
      registerWithPassword(
        input.callApiTask,
        (token) => input.setToken(token),
        email,
        password,
        debug,
        (token) => input.setRefreshToken(token),
        (user, token, refreshToken) => input.setAuth(user, token, refreshToken),
      ),
    logout: async () =>
      logoutWithCleanup({
        callApi: input.callApiTask,
        clearAuth: () => input.clearAuth(),
        stopAllPolling: () => input.stopAllPolling(),
      }),
  };
}
