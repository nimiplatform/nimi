import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { readTesterSettingsSurface } from './settings-surface-read.mjs';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readSettingsSurface() {
  return readTesterSettingsSurface(root);
}

test('tester settings consumes SDK product-control projection as second consumer proof', () => {
  const settings = readSettingsSurface();
  const helper = read('src/tester/tester-product-control-projection.ts');
  assert.match(settings, /loadTesterProductControlProjection/);
  assert.match(settings, /useTypedProjection\(loadTesterProductControlProjection/);
  assert.match(settings, /SDK product-control projection/);
  assert.match(helper, /reconcileRuntimeProductControlFirstRunSetupState/);
  assert.match(helper, /RuntimeProductControlClientFor<'reconcileProductControlFirstRunSetupState'>/);
  assert.match(helper, /runtimeMethod: 'reconcileProductControlFirstRunSetupState'/);
  assert.match(settings, /data_root_selected=\$\{productControlProjection\.data\.dataRootSelectedScreen\}/);
  assert.match(settings, /ai_environment_unconfigured=\$\{productControlProjection\.data\.aiEnvironmentScreen\}/);
  assert.doesNotMatch(settings, /parseProductControlProjectionJson/);
  assert.doesNotMatch(settings, /product_control_record_reconcile_first_run_setup_state/);
});

test('tester settings consumes the Kit commerce realm wallet projection', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /loadRealmCurrencyBalances/);
  assert.match(settings, /loadRealmGiftTransaction/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/commerce\/realm'/);
  assert.match(settings, /Realm wallet projection/);
  assert.match(settings, /Realm gift transaction projection/);
  assert.match(settings, /Spark \{walletProjection\.balances\.sparkBalance\}/);
  assert.match(settings, /Gem \{walletProjection\.balances\.gemBalance\}/);
  assert.match(settings, /refreshGiftTransactionProjection/);
  assert.match(settings, /testerGiftTransactionProjectionService/);
  assert.doesNotMatch(settings, /@runtime\/data-sync|dataSync\.loadCurrencyBalances|dataSync\.loadGiftTransaction/);
});

test('tester settings consumes the SDK Realm notification unread projection', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /loadRealmNotificationUnreadCount/);
  assert.match(settings, /loadRealmNotifications/);
  assert.match(settings, /toRealmNotificationListProjection/);
  assert.match(settings, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /from '@nimiplatform\/kit\/core\/notifications'/);
  assert.match(settings, /getNimiNotificationServerFilter/);
  assert.match(settings, /getNimiNotificationCategory/);
  assert.match(settings, /getNimiNotificationBadgeKey/);
  assert.match(settings, /Realm notification projection/);
  assert.match(settings, /Realm notification list \+ Kit headless projection/);
  assert.match(settings, /Unread \$\{notificationProjection\.unread\.total\}/);
  assert.match(settings, /refreshNotificationListProjection/);
  assert.match(settings, /loadRealmNotifications\(getPlatformClient\(\)\.realm/);
  assert.match(settings, /\bRealmNotificationListProjection\b/);
  assert.doesNotMatch(settings, /@runtime\/data-sync|dataSync\.loadNotificationUnreadCount|dataSync\.loadNotifications/);
  assert.doesNotMatch(settings, /type RealmNotificationListResultDto/);
});

test('tester settings consumes the SDK Realm account-data export helper', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /requestDataExport/);
  assert.match(settings, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /Realm account-data export projection/);
  assert.match(settings, /requestAccountDataExportProjection/);
  assert.match(settings, /getPlatformClient\(\)\.realm/);
  assert.doesNotMatch(settings, /@runtime\/data-sync|dataSync\.requestDataExport/);
  assert.doesNotMatch(settings, /requestAccountDeletion/);
});

test('tester settings consumes the SDK Realm account settings helper', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /loadRealmCreatorEligibility/);
  assert.match(settings, /\bRealmCreatorEligibilityDto\b/);
  assert.match(settings, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /SDK Realm account settings projection/);
  assert.match(settings, /refreshAccountSettingsProjection/);
  assert.match(settings, /loadRealmCreatorEligibility\(getPlatformClient\(\)\.realm\)/);
  assert.doesNotMatch(settings, /@runtime\/data-sync|dataSync\.loadMyCreatorEligibility/);
});

test('tester settings consumes the Kit Realm human chat helper', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /listRealmChats/);
  assert.match(settings, /\bRealmListChatsResultDto\b/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/chat\/realm'/);
  assert.match(settings, /Kit Realm human chat projection/);
  assert.match(settings, /refreshHumanChatProjection/);
  assert.match(settings, /const chats = await listRealmChats\(20\)/);
  assert.doesNotMatch(settings, /@runtime\/data-sync|dataSync\.loadChats/);
});

test('tester settings consumes the SDK Realm group chat helper', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /listRealmGroupChats/);
  assert.match(settings, /\bRealmGroupChatListResultDto\b/);
  assert.match(settings, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /SDK Realm group chat projection/);
  assert.match(settings, /refreshGroupChatProjection/);
  assert.match(settings, /listRealmGroupChats\(getPlatformClient\(\)\.realm, 20\)/);
  assert.doesNotMatch(settings, /@runtime\/data-sync|dataSync\.loadGroupChats/);
});

test('tester settings consumes the SDK Realm media URL projection', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /resolveRealmMediaUrl/);
  assert.match(settings, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /Realm media URL projection/);
  assert.match(settings, /realmMediaUrlProjection/);
  assert.doesNotMatch(settings, /\$\{[^}]*realmBaseUrl[^}]*\}\$\{[^}]*mediaUrl[^}]*\}/);
  assert.doesNotMatch(settings, /new URL\([^)]*api\/resources/);
});

test('tester settings consumes the SDK Realm resource upload orchestration helper', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /uploadRealmResourceFileWithRealm/);
  assert.match(settings, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /Realm resource upload projection/);
  assert.match(settings, /resourceUploadProjection\.summary\.resourceId/);
  assert.match(settings, /ResourcesService/);
  assert.match(settings, /fetchImpl: async \(\) => new Response/);
  assert.doesNotMatch(settings, /fetch\(uploadUrl/);
  assert.doesNotMatch(settings, /finalizeResource\(.*tester-resource-upload/);
});

test('tester settings consumes the SDK Realm endpoint projection', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /projectRealmBaseUrl/);
  assert.match(settings, /projectRealmRealtimeUrl/);
  assert.match(settings, /REALM_FEED_SCOPES/);
  assert.match(settings, /isRealmFeedScope/);
  assert.match(settings, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /Realm endpoint projection/);
  assert.match(settings, /Realm realtime projection/);
  assert.match(settings, /Realm feed scope projection/);
  assert.match(settings, /realmEndpointProjection/);
  assert.match(settings, /realmRealtimeProjection/);
  assert.match(settings, /realmFeedScopeProjection/);
  assert.doesNotMatch(settings, /function normalizeRealmBaseUrl/);
  assert.doesNotMatch(settings, /new URL\([^)]*realmBaseUrl/);
});

test('tester settings consumes Kit Realm chat attachment primitives', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /createRealmChatResourceAttachmentPayload/);
  assert.match(settings, /resolveRealmChatMediaUrl/);
  assert.match(settings, /resolveRealmChatAttachmentPreviewText/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/chat\/realm'/);
  assert.match(settings, /Realm chat attachment projection/);
  assert.match(settings, /realmChatAttachmentProjection/);
  assert.doesNotMatch(settings, /function resolveCanonicalChatAttachmentRecords/);
  assert.doesNotMatch(settings, /\$\{[^}]*realmBaseUrl[^}]*\}\$\{[^}]*url[^}]*\}/);
});

test('tester settings consumes the Kit avatar voice cue projection', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /resolveAgentVoicePlaybackCue/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/avatar\/headless'/);
  assert.match(settings, /Kit avatar voice cue projection/);
  assert.match(settings, /avatarVoiceCueProjection\.visemeId/);
  assert.doesNotMatch(settings, /function resolveAgentVoicePlaybackSignalFeatures/);
  assert.doesNotMatch(settings, /zeroCrossingRate/);
});

test('tester settings consumes neutral Kit avatar backend framing projections', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /resolveAvatarVrmFramingPolicy/);
  assert.match(settings, /resolveAvatarLive2dFramingPolicy/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/avatar\/vrm'/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/avatar\/live2d'/);
  assert.match(settings, /Kit avatar framing projection/);
  assert.match(settings, /avatarFramingProjection\.vrm/);
  assert.match(settings, /avatarFramingProjection\.live2d/);
  assert.doesNotMatch(settings, /chat-focus|scene-presence|showcase/);
});

test('tester settings consumes SDK Runtime recommendation enum projections', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /normalizeLocalRecommendationFeedCacheStateId/);
  assert.match(settings, /parseLocalRecommendationFeedSourceId/);
  assert.match(settings, /summarizeLocalRecommendationFeedCacheState/);
  assert.match(settings, /localRecommendationTierToRunGrade/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Runtime recommendation projection/);
  assert.match(settings, /LOCAL_RECOMMENDATION_TIER_RUNNABLE/);
  assert.doesNotMatch(settings, /switch\s*\([^)]*LOCAL_RECOMMENDATION_FEED_SOURCE_MODEL_INDEX/);
});

test('tester settings consumes SDK Runtime recommendation feed parser projection', () => {
  const settings = readSettingsSurface();
  const recommendationCopyProjection = read('src/tester/tester-local-recommendation-copy-projection.ts');

  assert.match(settings, /parseRuntimeLocalRecommendationFeedDescriptor/);
  assert.match(settings, /createTesterLocalRecommendationCopyProjection/);
  assert.match(recommendationCopyProjection, /summarizeLocalCatalogRecommendation[\s\S]*formatLocalRecommendationReasonLabel[\s\S]*buildLocalRecommendationDetailItems/);
  assert.match(recommendationCopyProjection, /collectLocalRecommendationFeedProviders[\s\S]*countLocalRecommendationRunGrades[\s\S]*filterLocalRecommendationFeedItems[\s\S]*parseLocalRecommendationLicenseShort[\s\S]*splitLocalRecommendationFeedItems/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Runtime recommendation feed parser/);
  assert.doesNotMatch(settings, /function parseRecommendationFeedDescriptor/);
  assert.doesNotMatch(settings, /function recommendationReasonLabel/);
  assert.doesNotMatch(settings, /new Set\([^)]*LOCAL_RECOMMENDATION/);
});

test('tester settings consumes SDK Runtime connector inventory projection', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /createRuntimeConnectorInventoryClient/);
  assert.match(settings, /runtimeConnectorInventory\.listConnectors/);
  assert.match(settings, /Runtime connector projection/);
  assert.match(settings, /runtimeAdmin: \(\) => getPlatformClient\(\)\.domains\.runtimeAdmin/);
  assert.doesNotMatch(settings, /listProviderCatalog\(|listConnectorModels\(|ConnectorKind\.REMOTE_MANAGED/);
});

test('tester settings consumes SDK Runtime model catalog projection', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /createRuntimeModelCatalogClient/);
  assert.match(settings, /runtimeModelCatalogProjection\.listProviders/);
  assert.match(settings, /Runtime model catalog projection/);
  assert.match(settings, /ModelCatalogProviderSource\.CUSTOM/);
  assert.doesNotMatch(settings, /function normalizeRuntimeModelCatalogProvider/);
  assert.doesNotMatch(settings, /runtimeJsonToProtoStruct|runtimeProtoStructToJson/);
});

test('tester settings consumes SDK Runtime reason-code message projection', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /getRuntimeReasonCodeDefaultMessage/);
  assert.match(settings, /toRuntimeUserFacingError/);
  assert.match(settings, /normalizeRuntimeReasonCode/);
  assert.match(settings, /extractRuntimeReasonCodeFromError/);
  assert.match(settings, /extractNimiErrorFields/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /from '@nimiplatform\/sdk\/types'/);
  assert.match(settings, /ReasonCode\.AI_PROVIDER_TIMEOUT/);
  assert.match(settings, /ReasonCode\.AI_CONNECTOR_CREDENTIAL_MISSING/);
  assert.match(settings, /Runtime reason projection/);
  assert.match(settings, /runtimeReasonProjection\.credentialMissing/);
  assert.match(settings, /runtimeReasonProjection\.numeric/);
  assert.match(settings, /runtimeReasonProjection\.extracted/);
  assert.match(settings, /runtimeReasonProjection\.presented/);
  assert.match(settings, /runtimeReasonProjection\.traceId/);
  assert.doesNotMatch(settings, /AI provider request timed out\./);
  assert.doesNotMatch(settings, /AI connector credentials are missing\./);
});

test('tester settings consumes SDK Runtime LocalAgent identity projection', () => {
  const settings = readSettingsSurface();
  assert.match(settings, /projectRuntimeLocalAgentIdentity/);
  assert.match(settings, /buildRuntimeAgentRequestContext/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Runtime LocalAgent identity projection/);
  assert.match(settings, /runtimeAgentRequestContextProjection\.localAgentRef/);
  assert.doesNotMatch(settings, /`local-agent:\$\{/);
});

test('tester settings consumes SDK offline reason-code projection', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /classifyOfflineError/);
  assert.match(settings, /classifyOfflineReasonCode/);
  assert.match(settings, /createOfflineNimiError/);
  assert.match(settings, /classifyOfflineError\(createOfflineNimiError\(/);
  assert.match(settings, /from '@nimiplatform\/sdk\/types'/);
  assert.match(settings, /ReasonCode\.REALM_UNAVAILABLE/);
  assert.match(settings, /ReasonCode\.RUNTIME_UNAVAILABLE/);
  assert.match(settings, /Offline reason projection/);
  assert.match(settings, /offlineReasonProjection\.errorOwner/);
  assert.doesNotMatch(settings, /new Set\(\[/);
  assert.doesNotMatch(settings, /REALM_OFFLINE_REASON_CODES|RUNTIME_OFFLINE_REASON_CODES/);
});

test('tester settings consumes Kit typed projection lifecycle hook', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /useTypedProjection/);
  assert.match(settings, /from '@nimiplatform\/kit\/ui'/);
  assert.match(settings, /useTypedProjection\(resolveTesterLocalRuntimeFacadeProjection/);
  assert.match(settings, /useTypedProjection\(resolveTesterRealmDataSyncProjection/);
  assert.match(settings, /localRuntimeFacadeProjection\.data/);
  assert.match(settings, /realmDataSyncProjection\.data/);
  assert.doesNotMatch(settings, /setLocalRuntimeFacadeProjection|setRealmDataSyncProjection/);
});

test('tester settings consumes SDK Runtime dependency state projections', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /isLocalRuntimeEnvironmentDependencyStartableState/);
  assert.match(settings, /isLocalRuntimeEnvironmentDependencyJobActiveState/);
  assert.match(settings, /isLocalRuntimeEnvironmentDependencyJobRetryableState/);
  assert.match(settings, /isLocalRuntimeEnvironmentDependencyJobTransferringState/);
  assert.match(settings, /isLocalRuntimeEnvironmentDependencyRepairRequiredState/);
  assert.match(settings, /buildLocalRuntimeImageNativeEnvironmentPlanPayload/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Runtime dependency state projection/);
  assert.match(settings, /SDK local image runtime dependency projection/);
  assert.doesNotMatch(settings, /ACTIVE_RUNTIME_DEPENDENCY_JOB_STATES/);
  assert.doesNotMatch(settings, /STARTABLE_RUNTIME_DEPENDENCY_STATES/);
  assert.doesNotMatch(settings, /JOB_TRANSFERRING_STATES/);
});
test('tester settings consumes SDK Runtime dependency parser and first-run materialization projections', () => {
  const settings = readSettingsSurface();
  assert.match(settings, /parseLocalRuntimeEnvironmentPlanProjection[\s\S]*parseLocalRuntimeEnvironmentDependencyJobProjection/);
  assert.match(settings, /selectFactoryAIProfileForFirstRun[\s\S]*PLATFORM_AI_PROFILE_FACTORY_ROWS/);
  assert.match(settings, /productStateForMaterializationStatus/);
  assert.match(settings, /recoveryDisposition: 'auto_retry_transient'/);
  assert.match(settings, /aggregateMaterializationDownloadProgress[\s\S]*retryableInterruptedFirstRunMaterializationJobs[\s\S]*repairableFirstRunMaterializationDependencies/);
  assert.match(settings, /from '@nimiplatform\/sdk\/platform-catalog'[\s\S]*from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Runtime dependency parser projection[\s\S]*First-run materialization projection/);
  assert.doesNotMatch(settings, /install-level-policy|JOB_TRANSFERRING_STATES/);
});
test('tester settings consumes SDK local runtime asset id projection', () => {
  const settings = readSettingsSurface();
  const assetKindProjection = read('src/tester/tester-local-runtime-asset-kind-projection.ts');

  assert.match(settings, /toCanonicalLocalRuntimeAssetId/);
  assert.match(settings, /toCanonicalLocalRuntimeAssetLookupKey/);
  assert.match(settings, /createTesterLocalRuntimeAssetKindProjection/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Local runtime asset id projection/);
  assert.match(settings, /localRuntimeAssetIdProjection\.lookupKey/);
  assert.match(settings, /localRuntimeAssetKindProjection\.dependencyAssetKind/);
  for (const helper of [
    'formatLocalRuntimeAssetKindLabel',
    'normalizeLocalRuntimeAssetDeclaration',
    'normalizeLocalRuntimeDependencyAssetDeclaration',
    'canImportLocalRuntimeAssetDeclaration',
  ]) {
    assert.match(assetKindProjection, new RegExp(helper));
  }
  assert.doesNotMatch(settings, /@runtime\/local-runtime\/local-id/);
});

test('tester settings consumes SDK local runtime facade DX surface', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /bindLocalRuntimeServiceClientProvider/);
  assert.match(settings, /listRuntimeLocalAssetEntries/);
  assert.match(settings, /localRuntime\.listAssets\(\{ kind: 'chat' \}\)/);
  assert.match(settings, /SDK local runtime facade projection/);
  assert.match(settings, /tester\/local-facade-asset/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
});

test('tester settings consumes SDK Realm data sync DX surface', () => {
  const settings = readSettingsSurface();
  const worldDisplayProjection = read('src/tester/tester-world-display-projection.ts');
  const worldEvolutionSelectorRead = read('src/tester/tester-world-evolution-selector-read.ts');
  const realmSocialFeed = read('src/tester/tester-realm-social-feed-projection.ts');
  const realmAgentProfile = read('src/tester/tester-realm-agent-profile-projection.ts');
  const realmAuth = read('src/tester/tester-realm-auth-projection.ts');
  const realmLocalAgentIntents = read('src/tester/tester-realm-local-agent-intents-projection.ts');

  assert.match(settings, /loadRealmSocialSnapshot/);
  assert.match(settings, /loadRealmWorldSemanticBundle/);
  assert.match(settings, /createTesterWorldDisplayProjection/);
  assert.match(worldDisplayProjection, /worldDisplay\.toSemanticBundle[\s\S]*worldDisplay\.toData/);
  assert.match(settings, /SDK Realm data sync projection/);
  assert.match(settings, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /SDK World Evolution selector-read projection/);
  assert.match(settings, /loadTesterWorldEvolutionSelectorReadProjection/);
  assert.match(worldEvolutionSelectorRead, /createMissingWorldEvolutionSelectorReadProvider/);
  assert.match(worldEvolutionSelectorRead, /missingEvidenceCategory/);
  assert.match(worldEvolutionSelectorRead, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /SDK Realm social\/feed projection/);
  assert.match(settings, /loadTesterRealmSocialFeedProjection/);
  assert.match(realmSocialFeed, /loadRealmPostFeed/);
  assert.match(realmSocialFeed, /loadRealmExploreFeedItems/);
  assert.match(realmSocialFeed, /executeRealmSocialMutation/);
  assert.match(realmSocialFeed, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /SDK Realm agent profile projection/);
  assert.match(settings, /loadTesterRealmAgentProfileProjection/);
  assert.match(realmAgentProfile, /loadRealmAgentDetails/);
  assert.match(realmAgentProfile, /loadRealmCreatorAgents/);
  assert.match(realmAgentProfile, /createRealmMasterAgent/);
  assert.match(realmAgentProfile, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /SDK Realm auth projection/);
  assert.match(settings, /loadTesterRealmAuthProjection/);
  assert.match(realmAuth, /checkRealmAuthEmail/);
  assert.match(realmAuth, /loginRealmAuthPassword/);
  assert.match(realmAuth, /loginRealmOAuth/);
  assert.match(realmAuth, /toRealmOAuthLoginResultDto/);
  assert.match(realmAuth, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /SDK Realm local-agent intents projection/);
  assert.match(settings, /loadTesterRealmLocalAgentIntentsProjection/);
  assert.match(realmLocalAgentIntents, /listRealmLocalAgentProvisionIntents/);
  assert.match(realmLocalAgentIntents, /ackRealmLocalAgentProvisionIntent/);
  assert.match(realmLocalAgentIntents, /listRealmLocalAgentTerminationIntents/);
  assert.match(realmLocalAgentIntents, /ackRealmLocalAgentTerminationIntent/);
  assert.match(realmLocalAgentIntents, /from '@nimiplatform\/sdk\/realm'/);
});

test('tester settings consumes SDK memory embedding route availability projection', () => {
  const settings = readSettingsSurface();
  const runtimeProjection = read('src/tester/tester-memory-embedding-runtime-projection.ts');

  assert.match(settings, /projectMemoryEmbeddingRouteAvailability/);
  assert.match(settings, /projectRuntimeAgentCanonicalMemoryBankStatus/);
  assert.match(settings, /createEmptyMemoryEmbeddingConfig/);
  assert.match(settings, /createTesterMemoryEmbeddingRuntimeProjection/);
  assert.match(runtimeProjection, /createProtectedHostMemoryEmbeddingRuntimeSurface/);
  assert.match(runtimeProjection, /AuthorizeExternalPrincipalResponse/);
  assert.match(runtimeProjection, /inspectTesterMemoryEmbeddingRuntimeProjection/);
  assert.match(runtimeProjection, /requestMemoryEmbeddingRuntimeBind/);
  assert.doesNotMatch(runtimeProjection, /buildMemoryEmbeddingAgentCoreLocator/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Memory embedding route projection/);
  assert.match(settings, /Runtime agent memory projection/);
  assert.doesNotMatch(settings, /connector\?\.available/);
  assert.doesNotMatch(settings, /String\(model\.status \|\| ''\)\.toLowerCase\(\) === 'active'/);
});

test('tester settings consumes SDK Runtime capability coverage projection', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /projectRuntimeRouteCapabilityCoverage/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Runtime capability coverage projection/);
  assert.match(settings, /runtimeCapabilityCoverageProjection/);
  assert.doesNotMatch(settings, /connectors\.some\(\(c\) => c\.status === 'healthy'\)/);
});

test('tester settings consumes SDK Runtime route capability projection builder', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /buildRuntimeRouteCapabilityProjection/);
  assert.match(settings, /createDefaultRuntimeRouteCapabilitySelectionStore/);
  assert.match(settings, /findRuntimeRouteModelProfile/);
  assert.match(settings, /getRuntimeRouteCapabilityProjectionIssueKind/);
  assert.match(settings, /isRuntimeRouteCapabilityProjectionReady/);
  assert.match(settings, /updateRuntimeRouteCapabilityBinding/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /resolveConversationRuntimeRouteSetupStateFromProjection/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/chat\/headless'/);
  assert.match(settings, /Runtime route capability projection/);
  assert.match(settings, /Runtime route model profile projection/);
  assert.match(settings, /runtimeCapabilityProjection\.summary\.reasonCode/);
  assert.match(settings, /runtimeCapabilityProjection\.summary\.issueKind/);
  assert.match(settings, /runtimeCapabilityProjection\.summary\.setupStatus/);
  assert.doesNotMatch(settings, /function buildRuntimeRouteCapabilityProjection/);
});

test('tester settings consumes SDK Runtime health coordinator diagnostics', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /RuntimeHealthCoordinator/);
  assert.match(settings, /CallerKind/);
  assert.match(settings, /RuntimeHealthStatus/);
  assert.match(settings, /UsageWindow/);
  assert.match(settings, /bridgeLocalRuntimeProfile/);
  assert.match(settings, /normalizeLocalRuntimeProfilesDeclaration/);
  assert.match(settings, /parseLocalRuntimeExecutionPlan/);
  assert.match(settings, /parseLocalRuntimeServiceDescriptor/);
  assert.match(settings, /parseLocalRuntimeNodeDescriptor/);
  assert.match(settings, /projectRuntimeAuditCallerKindName/);
  assert.match(settings, /projectRuntimeHealthStatusName/);
  assert.match(settings, /projectRuntimeHealthSummary/);
  assert.match(settings, /projectRuntimeUsageWindowName/);
  assert.match(settings, /toIsoFromTimestamp/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /SDK runtime health summary projection/);
  assert.match(settings, /SDK runtime health wire projection/);
  assert.match(settings, /SDK local runtime profile projection/);
  assert.match(settings, /SDK local runtime execution plan projection/);
  assert.match(settings, /SDK local runtime service\/node projection/);
  assert.match(settings, /SDK runtime audit wire projection/);
  assert.match(settings, /runtimeHealthSummaryProjection\.health\.checkedAt/);
  assert.match(settings, /runtimeHealthWireProjection\.statusName/);
  assert.match(settings, /localRuntimeProfileProjection\.runtimeEntryCount/);
  assert.match(settings, /localRuntimeExecutionPlanProjection\.deviceProfile\.arch/);
  assert.match(settings, /localRuntimeServiceNodeProjection\.node\.adapter/);
  assert.match(settings, /runtimeAuditWireProjection\.callerKindName/);
  assert.match(settings, /SDK runtime health coordinator projection/);
  assert.match(settings, /runtimeHealthCoordinatorDiagnostics\.getSnapshot/);
  assert.doesNotMatch(settings, /class RuntimeHealthCoordinator/);
  assert.doesNotMatch(settings, /RuntimeHealthStatus enum: 0=UNSPECIFIED/);
  assert.doesNotMatch(settings, /HEALTH_WATCHDOG_INTERVAL_MS/);
});

test('tester settings consumes SDK Nimi App bridge projection parser', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /parseNimiAppBridgeProjection/);
  assert.match(settings, /parseAccountAppLibraryRecord/);
  assert.match(settings, /from '@nimiplatform\/sdk\/app'/);
  assert.match(settings, /SDK Nimi App bridge projection/);
  assert.match(settings, /SDK account app-library projection/);
  assert.match(settings, /SDK permission client projection/);
  assert.match(settings, /appBridgeProjection\.releaseDescriptors/);
  assert.match(settings, /appBridgeProjection\.registryRows/);
  assert.doesNotMatch(settings, /appBridgeProjection\.installEvidence/);
  assert.match(settings, /accountAppLibraryProjection\.apps/);
  assert.match(settings, /new PermissionClient\(transport\)/);
  assert.match(settings, /client\.status\(scopeRef\)/);
  assert.match(settings, /client\.list\(scopeRef\)/);
  assert.doesNotMatch(settings, /apps-projection/);
  assert.doesNotMatch(settings, /ADMISSION_STATUSES|RELEASE_DESCRIPTOR_CLASSES|VERIFICATION_STATES/);
  assert.doesNotMatch(settings, /LIBRARY_STATES|DATA_POLICIES/);
});

test('tester settings consumes SDK Runtime agent consumer projections', () => {
  const settings = readSettingsSurface();
  const helper = read('src/tester/tester-runtime-agent-turn-runner.ts');
  const mediaHelper = read('src/tester/tester-runtime-media-generation-runner.ts');

  assert.match(settings, /buildRuntimeAgentSnapshotRecoveryEvents/);
  assert.match(settings, /summarizeRuntimeAgentProjectionEvent/);
  assert.match(settings, /summarizeRuntimeAgentTimeline/);
  assert.match(settings, /matchesRuntimeAgentProjectionScope/);
  assert.match(settings, /inspectTesterRuntimeAgentTurnRunnerProjection/);
  assert.match(settings, /inspectTesterRuntimeMediaGenerationRunnerProjection/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Runtime agent consumer projection/);
  assert.match(settings, /Runtime agent turn runner projection/);
  assert.match(settings, /Runtime media generation runner projection/);
  assert.match(settings, /runtimeAgentConsumerProjection\.terminalEventName/);
  assert.match(settings, /runtimeAgentTurnRunnerProjection\.projection\.sealedMessageId/);
  assert.match(settings, /runtimeMediaGenerationRunnerProjection\.projection\.artifactCount/);
  assert.match(helper, /runRuntimeAgentTurn/);
  assert.match(helper, /RuntimeAgentTurnsModule/);
  assert.match(mediaHelper, /runRuntimeMediaGenerationJob/);
  assert.match(mediaHelper, /RuntimeMediaGenerationJobsModule/);
  assert.doesNotMatch(settings, /function buildRuntimeAgentSnapshotRecoveryEvents/);
  assert.doesNotMatch(settings, /function summarizeRuntimeAgentTimeline/);
});

test('tester settings consumes SDK Runtime agent inspect projections', () => {
  const settings = readSettingsSurface();
  const helper = read('src/tester/tester-runtime-agent-inspect-projection.ts');
  [/createTesterRuntimeAgentInspectProjection/, /Runtime agent inspect projection/, /runtimeAgentInspectProjection\.mutationKinds/].forEach((pattern) => assert.match(settings, pattern));
  [/createHostRuntimeAgentInspectSurface/, /inspectTesterRuntimeAgentSurfaceProjection/, /projectRuntimeAgentInspectSnapshot/, /projectRuntimeAgentInspectEventSummary/, /projectRuntimeAgentPendingHookInspect/, /buildRuntimeAgentStateMutations/, /readRuntimeAgentPresentationProfile/, /from '@nimiplatform\/sdk\/runtime'/].forEach((pattern) => assert.match(helper, pattern));
});
test('tester settings consumes SDK Runtime agent presentation profile projection', () => { const settings = readSettingsSurface(); const helper = read('src/tester/tester-runtime-agent-presentation-profile.ts'); [/createTesterRuntimeAgentPresentationProfileProjection/, /Runtime agent presentation profile projection/, /runtimeAgentPresentationProfileProjection\.defaultVoiceReference/].forEach((pattern) => assert.match(settings, pattern)); [/buildSetRuntimeAgentPresentationProfileRequest/, /parseRuntimeLocalAgentIdentity/, /normalizeRuntimeAgentPresentationDefaultVoiceReference/, /from '@nimiplatform\/sdk\/runtime'/].forEach((pattern) => assert.match(helper, pattern)); });
test('tester settings consumes SDK Runtime external agent projections', () => { const settings = readSettingsSurface(); const helper = read('src/tester/tester-external-agent-projection.ts'); [/createTesterExternalAgentProjection/, /Runtime external agent projection/, /externalAgentProjection\.gateway\.actionCount/].forEach((pattern) => assert.match(settings, pattern)); [/createHostRuntimeExternalAgentAccessSurface/, /createTesterExternalAgentAccessSurface/, /loadTesterExternalAgentProjection/, /projectExternalAgentIssueTokenResult/, /parseExternalAgentTokenLedgerRecord/, /projectExternalAgentGatewayStatus/, /from '@nimiplatform\/sdk\/runtime'/].forEach((pattern) => assert.match(helper, pattern)); });
test('tester settings consumes SDK Runtime struct codec projection', () => {
  const settings = readSettingsSurface();
  assert.match(settings, /toProtoStruct/);
  assert.match(settings, /fromProtoStruct/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Runtime struct codec projection/);
  assert.match(settings, /runtimeStructProjection\.auditKind/);
  assert.doesNotMatch(settings, /function jsonToProtoStruct/);
  assert.doesNotMatch(settings, /function decodeProtoDynamic/);
});

test('tester settings consumes SDK local route option binding projection', () => {
  const settings = readSettingsSurface();
  assert.match(settings, /isRuntimeRouteLocalOptionSelectable/);
  assert.match(settings, /runtimeRouteLocalOptionToBinding/);
  assert.match(settings, /runtimeRouteBindingsMatch/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Local route option projection/);
  assert.match(settings, /Runtime route binding match projection/);
  assert.doesNotMatch(settings, /source:\s*'local',\s*connectorId:\s*''/);
});

test('tester settings consumes SDK runtime route reasoning projection', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /resolveRuntimeTextRouteReasoningSupport/);
  assert.match(settings, /resolveRuntimeRouteReasoningConfig/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Runtime route reasoning projection/);
  assert.match(settings, /runtimeRouteReasoningProjection\.traceMode/);
  assert.doesNotMatch(settings, /function resolveRuntimeTextRouteReasoningSupport/);
});

test('tester settings consumes SDK runtime route DX helpers from runtime surface', () => {
  const settings = readSettingsSurface(); const runtimeConfigProjection = read('src/tester/tester-runtime-config-projection.ts'); const runtimeRouteHostAccess = read('src/tester/tester-runtime-route-host-access.ts');

  assert.match(settings, /buildRuntimeTargetCallOptions/);
  assert.match(settings, /buildRuntimeRequestMetadata/);
  assert.match(settings, /loadTesterRuntimeRouteHostAccessProjection/);
  assert.match(settings, /Runtime route host access projection/);
  assert.match(settings, /mapRuntimeErrorToLocalAiReasonCode/);
  assert.match(settings, /checkRuntimeRouteProviderHealth/);
  assert.match(settings, /ModelHealthStatus/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Runtime call options projection/); assert.match(settings, /Runtime config projection/); assert.match(settings, /createTesterRuntimeConfigProjection/);
  assert.match(settings, /Runtime request metadata projection/);
  assert.match(settings, /Runtime local AI reason projection/);
  assert.match(settings, /Runtime route provider health projection/);
  assert.doesNotMatch(settings, /function buildRuntimeTargetCallOptions/);
  assert.doesNotMatch(settings, /function checkRuntimeRouteProviderHealth/); [/createHostRuntimeRouteAccessSurface/, /buildCallOptions/, /checkLocalHealth/, /from '@nimiplatform\/sdk\/runtime'/].forEach((pattern) => assert.match(runtimeRouteHostAccess, pattern)); [/mergeRuntimeBridgeDataRootConfig/, /mergeRuntimeBridgeRealmJwtConfig/, /mergeRuntimeBridgeDeveloperRegistrationConfig/, /from '@nimiplatform\/sdk\/runtime'/].forEach((pattern) => assert.match(runtimeConfigProjection, pattern));
});

test('tester settings consumes Kit model picker binding projection', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /pickerSelectionToBinding/);
  assert.match(settings, /summarizeBinding/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/model-config\/headless'/);
  assert.match(settings, /Model picker binding projection/);
  assert.match(settings, /Kit model binding summary projection/);
  assert.doesNotMatch(settings, /toRuntimeRouteBindingFromPickerSelection/);
});

test('tester settings consumes SDK runtime voice schedule and Kit avatar cue projection', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /resolveRuntimeAgentVoicePlaybackDecision/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /SDK runtime voice schedule projection/);
  assert.match(settings, /runtimeAvatarVoiceProjection\.cueCount/);
  assert.doesNotMatch(settings, /function resolveRuntimeAgentVoicePlaybackDecision/);
});
