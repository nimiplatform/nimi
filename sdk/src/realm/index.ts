/* eslint-disable */
// AUTO-GENERATED FACADE from realm/generated/* and selected typed adapters. DO NOT EDIT BY HAND.

export { AccountRole } from './generated/models/AccountRole.js';
export { AccountStatus } from './generated/models/AccountStatus.js';
export { AgentCategory } from './generated/models/AgentCategory.js';
export { AgentImportance } from './generated/models/AgentImportance.js';
export { AgentOrigin } from './generated/models/AgentOrigin.js';
export { AgentOwnershipType } from './generated/models/AgentOwnershipType.js';
export { AgentRelationType } from './generated/models/AgentRelationType.js';
export { AgentState } from './generated/models/AgentState.js';
export { AgentWakeStrategy } from './generated/models/AgentWakeStrategy.js';
export { ApiKeyType } from './generated/models/ApiKeyType.js';
export { AttachmentDisplayKind } from './generated/models/AttachmentDisplayKind.js';
export { AttachmentTargetType } from './generated/models/AttachmentTargetType.js';
export { ContentRatingString } from './generated/models/ContentRatingString.js';
export { DnaSecondaryTrait } from './generated/models/DnaSecondaryTrait.js';
export { Gender } from './generated/models/Gender.js';
export { GiftStatus } from './generated/models/GiftStatus.js';
export { LocalAgentProvisionIntentAckOutcome } from './generated/models/LocalAgentProvisionIntentAckOutcome.js';
export { LocalAgentProvisionIntentStatus } from './generated/models/LocalAgentProvisionIntentStatus.js';
export { LocalAgentTerminationIntentAckOutcome } from './generated/models/LocalAgentTerminationIntentAckOutcome.js';
export { LocalAgentTerminationIntentStatus } from './generated/models/LocalAgentTerminationIntentStatus.js';
export { MessageType } from './generated/models/MessageType.js';
export { ModerationStatusString } from './generated/models/ModerationStatusString.js';
export { OAuthProvider } from './generated/models/OAuthProvider.js';
export { PresenceStatus } from './generated/models/PresenceStatus.js';
export { ReportReason } from './generated/models/ReportReason.js';
export { ReviewRating } from './generated/models/ReviewRating.js';
export { StripeConnectStatus } from './generated/models/StripeConnectStatus.js';
export { SubscriptionTier } from './generated/models/SubscriptionTier.js';
export { VerificationTier } from './generated/models/VerificationTier.js';
export { Visibility } from './generated/models/Visibility.js';
export { WithdrawalStatus } from './generated/models/WithdrawalStatus.js';

// Generated type helpers.
export type { RealmModels, RealmModelName, RealmModel, RealmOperations, RealmOperationName, RealmOperation, RealmServiceName, RealmServiceMethod, RealmServiceArgs, RealmServiceResult } from './generated/type-helpers.js';

// Typed adapter exports.
export type { AccountDataTaskStatus, RequestDataExportInput, RequestDataExportOutput, RequestAccountDeletionInput, RequestAccountDeletionOutput } from './extensions/account-data.js';
export type { RealmBaseUrlProjectionInput, RealmRealtimeUrlProjectionInput } from './extensions/endpoint.js';
export type { RealmMediaUrlProjectionInput } from './extensions/media-url.js';
export type { RealmMarkNotificationsReadInputDto, RealmNotificationDto, RealmNotificationListOptions, RealmNotificationListResultDto, RealmNotificationReadProjection, RealmNotificationType, RealmNotificationsReadProjection, RealmNotificationUnreadProjection, RealmUnreadNotificationCountDto } from './extensions/notifications.js';
export type { RealmResourceDetail, RealmResourceDirectUploadSession, RealmResourceFinalizeInput, RealmResourceUploadClient, RealmResourceUploadInput, RealmResourceUploadKind, RealmResourceUploadResult, RealmResourceUploadTransportMode } from './extensions/resource-upload.js';
export { requestDataExport, requestAccountDeletion } from './extensions/account-data.js';
export { normalizeRealmBaseUrl, projectRealmBaseUrl, projectRealmRealtimeUrl } from './extensions/endpoint.js';
export { resolveRealmMediaUrl } from './extensions/media-url.js';
export { loadRealmNotificationUnreadCount, loadRealmNotifications, markRealmNotificationRead, markRealmNotificationsRead, normalizeRealmNotificationUnreadCount } from './extensions/notifications.js';
export { uploadRealmResourceFile } from './extensions/resource-upload.js';

// Realm client exports.
export { Realm } from './client.js';
export { createRealmClient } from './client-factory.js';
export type { RealmConnectionState, RealmTelemetryEvent, RealmTokenRefreshResult, RealmFetchImpl, RealmAuthOptions, RealmRetryOptions, RealmOptions, RealmUnsafeRawModule, RealmServiceRegistry, RealmEventsModule } from './client-types.js';
export type { RealmOperationKey, RealmOperationResult, RealmOperationResultMap } from './generated/operation-map.js';
export * from './generated/property-enums.js';
