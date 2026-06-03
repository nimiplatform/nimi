import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REALM_FACADE_RELATIVE_PATH, REALM_GENERATED_RELATIVE_PATH } from './constants.mjs';
import { classifyModelExport } from './model-utils.mjs';

export function writeRealmFacade(repoRoot) {
  const generatedModelsDir = path.join(repoRoot, REALM_GENERATED_RELATIVE_PATH, 'models');
  if (!existsSync(generatedModelsDir) || !statSync(generatedModelsDir).isDirectory()) {
    throw new Error(`generated models directory not found: ${generatedModelsDir}`);
  }

  const modelFiles = readdirSync(generatedModelsDir)
    .filter((entry) => entry.endsWith('.ts'))
    .sort((left, right) => left.localeCompare(right));

  const lines = [];
  lines.push('/* eslint-disable */');
  lines.push('// AUTO-GENERATED FACADE from realm/generated/* and selected typed adapters. DO NOT EDIT BY HAND.');
  lines.push('');

  for (const fileName of modelFiles) {
    const symbol = fileName.replace(/\.ts$/, '');
    const source = readFileSync(path.join(generatedModelsDir, fileName), 'utf8');
    const exportKind = classifyModelExport(source);
    if (exportKind !== 'value') {
      continue;
    }
    lines.push(`export { ${symbol} } from './generated/models/${symbol}.js';`);
  }

  lines.push('');
  lines.push('// Generated type helpers.');
  lines.push("export type { RealmModels, RealmModelName, RealmModel, RealmOperations, RealmOperationName, RealmOperation, RealmServiceName, RealmServiceMethod, RealmServiceArgs, RealmServiceResult } from './generated/type-helpers.js';");
  lines.push('');
  lines.push('// Typed adapter exports.');
  lines.push("export type { RealmCreatorEligibilityDto, RealmOAuthLinkProjection, RealmOAuthProvider, RealmPasswordUpdateProjection, RealmTwoFactorPrepareOutput, RealmTwoFactorProjection, RealmTwoFactorVerifyInput, RealmUpdatePasswordInput, RealmUpdateUserNotificationSettingsInput, RealmUpdateUserSettingsInput, RealmUserNotificationSettingsDto, RealmUserSettingsDto } from './extensions/account-settings.js';");
  lines.push("export type { AccountDataTaskStatus, RequestDataExportInput, RequestDataExportOutput, RequestAccountDeletionInput, RequestAccountDeletionOutput } from './extensions/account-data.js';");
  lines.push("export type { RealmAuthApiCaller, RealmAuthTokensDto, RealmCheckEmailResponseDto, RealmEmailOtpRequestResult, RealmOAuthLoginResultDto, RealmWalletChallengeInput, RealmWalletChallengeResult, RealmWalletLoginInput } from './extensions/auth.js';");
  lines.push("export type { RealmBaseUrlProjectionInput, RealmRealtimeUrlProjectionInput } from './extensions/endpoint.js';");
  lines.push("export type { RealmFeedScope } from './extensions/feed.js';");
  lines.push("export type { RealmGroupChatListResultDto, RealmGroupChatSyncResultDto, RealmGroupChatViewDto, RealmGroupCreateInputDto, RealmGroupMessageCandidateCommitInputDto, RealmGroupMessageCandidateCommitResultDto, RealmGroupMessageListResultDto, RealmGroupMessageType, RealmGroupMessageViewDto, RealmGroupParticipantDto, RealmGroupSendMessageInputDto } from './extensions/group-chat.js';");
  lines.push("export type { RealmLocalAgentIntentApiCaller, RealmLocalAgentProvisionIntentAckDto, RealmLocalAgentProvisionIntentDto, RealmLocalAgentTerminationIntentAckDto, RealmLocalAgentTerminationIntentDto } from './extensions/local-agent-intents.js';");
  lines.push("export type { RealmMediaUrlProjectionInput } from './extensions/media-url.js';");
  lines.push("export type { RealmMarkNotificationsReadInputDto, RealmNotificationDto, RealmNotificationItemProjection, RealmNotificationListOptions, RealmNotificationListProjection, RealmNotificationListResultDto, RealmNotificationReadProjection, RealmNotificationType, RealmNotificationsReadProjection, RealmNotificationUnreadProjection, RealmUnreadNotificationCountDto } from './extensions/notifications.js';");
  lines.push("export type { RealmResourceDetail, RealmResourceDirectUploadSession, RealmResourceFinalizeInput, RealmResourceUploadClient, RealmResourceUploadInput, RealmResourceUploadKind, RealmResourceUploadResult, RealmResourceUploadTransportMode, RealmResourceUploadWithRealmInput } from './extensions/resource-upload.js';");
  lines.push("export type { RealmSocialApiCaller, RealmSocialContactSnapshot, RealmSocialErrorEmitter } from './extensions/social-snapshot.js';");
  lines.push("export type { RealmWorldApiCaller, RealmWorldBindingListPayload, RealmWorldErrorEmitter, RealmWorldHistoryPayload, RealmWorldLorebookListPayload, RealmWorldSceneListPayload, RealmWorldSemanticBundle } from './extensions/world-data.js';");
  lines.push("export { disableRealmTwoFactor, enableRealmTwoFactor, linkRealmOAuth, loadRealmCreatorEligibility, loadRealmUserNotificationSettings, loadRealmUserSettings, prepareRealmTwoFactor, unlinkRealmOAuth, updateRealmPassword, updateRealmUserNotificationSettings, updateRealmUserSettings } from './extensions/account-settings.js';");
  lines.push("export { requestDataExport, requestAccountDeletion } from './extensions/account-data.js';");
  lines.push("export { checkRealmAuthEmail, createRealmWalletChallenge, isExpectedAnonymousRealmSessionError, loginRealmAuthPassword, loginRealmOAuth, loginRealmWallet, requestRealmEmailOtp, toRealmAuthTokensDto, toRealmAuthUserRecord, toRealmCheckEmailResponseDto, toRealmEmailOtpRequestResult, toRealmOAuthLoginResultDto, toRealmWalletChallengeResult, verifyRealmEmailOtp, verifyRealmTwoFactor } from './extensions/auth.js';");
  lines.push("export { normalizeRealmBaseUrl, projectRealmBaseUrl, projectRealmRealtimeUrl } from './extensions/endpoint.js';");
  lines.push("export { REALM_FEED_SCOPES, isRealmFeedScope } from './extensions/feed.js';");
  lines.push("export { addRealmGroupAgent, commitRealmGroupMessageCandidate, createRealmGroupChat, createRealmGroupTextMessageInput, listRealmGroupChats, loadRealmGroupChat, loadRealmGroupMessages, markRealmGroupRead, removeRealmGroupAgent, sendRealmGroupMessage, syncRealmGroupEvents } from './extensions/group-chat.js';");
  lines.push("export { ackRealmLocalAgentProvisionIntent, ackRealmLocalAgentTerminationIntent, listRealmLocalAgentProvisionIntents, listRealmLocalAgentTerminationIntents } from './extensions/local-agent-intents.js';");
  lines.push("export { resolveRealmMediaUrl } from './extensions/media-url.js';");
  lines.push("export { loadRealmNotificationUnreadCount, loadRealmNotifications, markRealmNotificationRead, markRealmNotificationsRead, normalizeRealmNotificationUnreadCount, toRealmNotificationItemProjection, toRealmNotificationListProjection } from './extensions/notifications.js';");
  lines.push("export { uploadRealmResourceFile, uploadRealmResourceFileWithRealm } from './extensions/resource-upload.js';");
  lines.push("export { enrichRealmProfileWithWorldBanner, fetchRealmAgentFriendLimit, fetchRealmPendingFriendRequests, loadRealmSocialSnapshot } from './extensions/social-snapshot.js';");
  lines.push("export { addRealmFriendById, blockRealmUser, buildEmptyRealmPostFeedResponse, createRealmPost, createRealmReport, deleteRealmPost, executeRealmSocialMutation, likeRealmPost, loadRealmCurrentUserProfile, loadRealmExploreAgents, loadRealmExploreFeedItems, loadRealmLikedPosts, loadRealmPostById, loadRealmPostFeed, loadRealmUserProfileById, removeRealmFriendById, unblockRealmUser, unlikeRealmPost, updateRealmCurrentUserProfile, updateRealmPostVisibility } from './extensions/social-feed.js';");
  lines.push("export type { LoadRealmExploreAgentsInput, RealmPostFeedInput, RealmSocialFeedApiCaller, RealmSocialFeedErrorEmitter, RealmSocialMutationExecutionInput, RealmSocialMutationKind } from './extensions/social-feed.js';");
  lines.push("export { createRealmMasterAgent, enrichRealmAgentProfileWithWorldBanner, loadRealmAgentDetails, loadRealmCreatorAgents } from './extensions/agent-profile.js';");
  lines.push("export type { CreateRealmMasterAgentInput, RealmAgentProfileApiCaller, RealmAgentProfileErrorEmitter } from './extensions/agent-profile.js';");
  lines.push("export { buildRealmWorldDetailWithAgentsCacheKey, loadRealmMainWorld, loadRealmWorldAgents, loadRealmWorldBindings, loadRealmWorldDetailById, loadRealmWorldDetailWithAgents, loadRealmWorldHistory, loadRealmWorldLevelAudits, loadRealmWorldList, loadRealmWorldLorebooks, loadRealmWorldScenes, loadRealmWorldSemanticBundle } from './extensions/world-data.js';");
  lines.push('');
  lines.push('// Realm client exports.');
  lines.push("export { Realm } from './client.js';");
  lines.push("export { createRealmClient } from './client-factory.js';");
  lines.push("export type { RealmConnectionState, RealmTelemetryEvent, RealmTokenRefreshResult, RealmFetchImpl, RealmAuthOptions, RealmRetryOptions, RealmOptions, RealmUnsafeRawModule, RealmServiceRegistry, RealmEventsModule } from './client-types.js';");
  lines.push("export type { RealmOperationKey, RealmOperationResult, RealmOperationResultMap } from './generated/operation-map.js';");
  lines.push("export * from './generated/property-enums.js';");
  lines.push('');

  writeFileSync(path.join(repoRoot, REALM_FACADE_RELATIVE_PATH), lines.join('\n'), 'utf8');
}
