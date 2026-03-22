import type { RealmGeneratedServiceRegistry } from './generated/service-registry.js';
import type { components } from './generated/schema.js';

type Assert<T extends true> = T;
type IsEqual<A, B> = (
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
);

type _ListCoreMemoriesArgs = Parameters<RealmGeneratedServiceRegistry['AgentsService']['agentControllerListCoreMemories']>;
type _ListDyadicMemoriesArgs = Parameters<RealmGeneratedServiceRegistry['AgentsService']['agentControllerListDyadicMemories']>;
type _CommitMemoryArgs = Parameters<RealmGeneratedServiceRegistry['AgentsService']['agentControllerCommitMemory']>;
type _IssueGrantArgs = Parameters<RealmGeneratedServiceRegistry['CreatorModsControlPlaneService']['creatorModsControllerIssueGrant']>;
type _IssueRuntimeRealmGrantArgs = Parameters<RealmGeneratedServiceRegistry['RuntimeRealmGrantsService']['issueRuntimeRealmGrant']>;
type _ListFriendsWithDetailsResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['MeService']['listMyFriendsWithDetails']>>;
type _GetCreatorAgentResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['CreatorService']['creatorControllerGetAgent']>>;
type _UpdateCreatorAgentResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['CreatorService']['creatorControllerUpdateAgent']>>;

type _ListCoreMemoriesResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['AgentsService']['agentControllerListCoreMemories']>>;
type _ListDyadicMemoriesResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['AgentsService']['agentControllerListDyadicMemories']>>;
type _CommitMemoryResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['AgentsService']['agentControllerCommitMemory']>>;
type _ListUserProfilesResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['AgentsService']['agentControllerListUserProfiles']>>;
type _IssueGrantResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['CreatorModsControlPlaneService']['creatorModsControllerIssueGrant']>>;
type _IssueRuntimeRealmGrantResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['RuntimeRealmGrantsService']['issueRuntimeRealmGrant']>>;
type _RequestDataExportArgs = Parameters<RealmGeneratedServiceRegistry['MeaccountdataService']['requestDataExport']>;
type _RequestAccountDeletionArgs = Parameters<RealmGeneratedServiceRegistry['MeaccountdataService']['requestAccountDeletion']>;
type _RequestDataExportResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['MeaccountdataService']['requestDataExport']>>;
type _RequestAccountDeletionResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['MeaccountdataService']['requestAccountDeletion']>>;

type _GuardWorldClockConfig = Assert<IsEqual<
  components['schemas']['WorldDetailDto']['clockConfig'],
  components['schemas']['WorldClockConfigDto'] | undefined
>>;
type _GuardWorldTimeModel = Assert<IsEqual<
  components['schemas']['WorldDetailDto']['timeModel'],
  components['schemas']['TimeModelDto'] | undefined
>>;
type _GuardWorldLanguages = Assert<IsEqual<
  components['schemas']['WorldDetailDto']['languages'],
  components['schemas']['WorldviewLanguagesDto'] | undefined
>>;
type _GuardWorldSceneTimeConfig = Assert<IsEqual<
  components['schemas']['WorldDetailDto']['sceneTimeConfig'],
  components['schemas']['SceneTimeConfigDto'] | undefined
>>;

type _GuardWorldviewTimeModel = Assert<IsEqual<
  components['schemas']['WorldviewDetailDto']['timeModel'],
  components['schemas']['TimeModelDto']
>>;
type _GuardWorldviewSpaceTopology = Assert<IsEqual<
  components['schemas']['WorldviewDetailDto']['spaceTopology'],
  components['schemas']['SpaceTopologyDto']
>>;
type _GuardWorldviewCausality = Assert<IsEqual<
  components['schemas']['WorldviewDetailDto']['causality'],
  components['schemas']['CausalityModelDto']
>>;
type _GuardWorldviewCoreSystem = Assert<IsEqual<
  components['schemas']['WorldviewDetailDto']['coreSystem'],
  components['schemas']['PowerSystemDto']
>>;
type _GuardWorldviewLanguages = Assert<IsEqual<
  components['schemas']['WorldviewDetailDto']['languages'],
  components['schemas']['WorldviewLanguagesDto'] | undefined
>>;
type _GuardWorldviewExistences = Assert<IsEqual<
  components['schemas']['WorldviewDetailDto']['existences'],
  components['schemas']['ExistenceDefinitionDto'] | undefined
>>;
type _GuardWorldviewResources = Assert<IsEqual<
  components['schemas']['WorldviewDetailDto']['resources'],
  components['schemas']['ResourceDefinitionDto'] | undefined
>>;
type _GuardWorldviewLocations = Assert<IsEqual<
  components['schemas']['WorldviewDetailDto']['locations'],
  components['schemas']['WorldviewLocationsDto'] | undefined
>>;
type _GuardWorldviewGlossary = Assert<IsEqual<
  components['schemas']['WorldviewDetailDto']['glossary'],
  components['schemas']['WorldviewGlossaryDto'] | undefined
>>;
type _GuardWorldviewVisualGuide = Assert<IsEqual<
  components['schemas']['WorldviewDetailDto']['visualGuide'],
  components['schemas']['VisualGuideDto'] | undefined
>>;
type _GuardWorldviewCausalityKarmaEnabled = Assert<IsEqual<
  components['schemas']['CausalityModelDto']['karmaEnabled'],
  boolean | undefined
>>;
type _GuardWorldviewCausalityFateWeight = Assert<IsEqual<
  components['schemas']['CausalityModelDto']['fateWeight'],
  number | undefined
>>;
type _GuardPowerSystemLevels = Assert<IsEqual<
  components['schemas']['PowerSystemDto']['levels'],
  components['schemas']['PowerSystemLevelDto'][] | undefined
>>;
type _GuardPowerSystemTaboos = Assert<IsEqual<
  components['schemas']['PowerSystemDto']['taboos'],
  components['schemas']['PowerSystemTabooDto'][] | undefined
>>;
type _GuardPowerSystemChildren = Assert<IsEqual<
  components['schemas']['PowerSystemDto']['powerSystems'],
  components['schemas']['PowerSystemDto'][] | undefined
>>;
type _GuardSpaceTopologyRealms = Assert<IsEqual<
  components['schemas']['SpaceTopologyDto']['realms'],
  components['schemas']['SpaceRealmDto'][] | undefined
>>;

type _GuardUserPrivateGiftStats = Assert<IsEqual<
  components['schemas']['UserPrivateDto']['giftStats'],
  {
    [key: string]: number;
  } | undefined
>>;

type _GuardUserProfileGiftStats = Assert<IsEqual<
  components['schemas']['UserProfileDto']['giftStats'],
  {
    [key: string]: number;
  } | undefined
>>;

type _GuardAgentProfileDto = Assert<IsEqual<
  components['schemas']['AgentProfileDto'],
  {
    activeWorldId?: string;
    importance?: components['schemas']['AgentImportance'];
    ownerWorldId?: string | null;
    ownershipType?: components['schemas']['AgentOwnershipType'];
    state?: components['schemas']['AgentState'];
    stats?: components['schemas']['AgentStatsDto'];
    worldId?: string;
  }
>>;

type _GuardFriendListResult = Assert<IsEqual<
  _ListFriendsWithDetailsResult,
  components['schemas']['FriendProfileListDto']
>>;

type _GuardCreateKeyEventDto = Assert<IsEqual<
  components['schemas']['CreateKeyEventDto'],
  {
    content: string;
    eventType: string;
    importance?: number;
    userId?: string;
  }
>>;

type _GuardUpdateCreatorAgentCapabilities = Assert<IsEqual<
  components['schemas']['UpdateCreatorAgentDto']['capabilities'],
  components['schemas']['UserAgentDnaDto'] | undefined
>>;
type _GuardGetCreatorAgentResult = Assert<IsEqual<
  _GetCreatorAgentResult['capabilities'],
  components['schemas']['UserAgentDnaDto'] | undefined
>>;
type _GuardUpdateCreatorAgentResult = Assert<IsEqual<
  _UpdateCreatorAgentResult['capabilities'],
  components['schemas']['UserAgentDnaDto'] | undefined
>>;

type _GuardUpdateUserProfileDto = Assert<IsEqual<
  components['schemas']['UpdateUserProfileDto'],
  {
    preferences?: components['schemas']['UpdateUserProfilePreferencesDto'];
    profileSummary?: string;
    traits?: components['schemas']['UpdateUserProfileTraitsDto'];
  }
>>;

type _GuardSendMessagePayload = Assert<IsEqual<
  components['schemas']['SendMessageInputDto']['payload'],
  {
    [key: string]: unknown;
  } | undefined
>>;

type _GuardMe2faOperationResultDto = Assert<IsEqual<
  components['schemas']['Me2faOperationResultDto'],
  {
    success: boolean;
  }
>>;

type _GuardActivateAgentResultDto = Assert<IsEqual<
  components['schemas']['ActivateAgentResultDto'],
  {
    state: components['schemas']['AgentState'];
    success: boolean;
  }
>>;

type _GuardBatchCreateAgentsResponseDto = Assert<IsEqual<
  components['schemas']['BatchCreateAgentsResponseDto'],
  {
    created: components['schemas']['BatchCreateAgentCreatedDto'][];
    failed: components['schemas']['BatchCreateAgentFailedDto'][];
  }
>>;

type _GuardUpdateAgentNsfwConsentDto = Assert<IsEqual<
  components['schemas']['UpdateAgentNsfwConsentDto'],
  {
    enabled: boolean;
  }
>>;

type _GuardUpdateUserNsfwConsentDto = Assert<IsEqual<
  components['schemas']['UpdateUserNsfwConsentDto'],
  {
    enabled: boolean;
  }
>>;

type _GuardUserSettingsNotificationSettings = Assert<IsEqual<
  components['schemas']['UserSettingsDto']['notificationSettings'],
  components['schemas']['UserNotificationSettingsDto'] | undefined
>>;

type _GuardUpdateUserSettingsNotificationSettings = Assert<IsEqual<
  components['schemas']['UpdateUserSettingsDto']['notificationSettings'],
  components['schemas']['UpdateUserNotificationSettingsDto'] | undefined
>>;

type _GuardListCoreFirstArg = Assert<_ListCoreMemoriesArgs[0] extends string ? true : false>;
type _GuardListCoreSecondArg = Assert<_ListCoreMemoriesArgs[1] extends number | undefined ? true : false>;
type _GuardListCoreResult = Assert<IsEqual<
  _ListCoreMemoriesResult,
  components['schemas']['AgentMemoryRecordDto'][]
>>;

type _GuardListDyadicFirstArg = Assert<_ListDyadicMemoriesArgs[0] extends string ? true : false>;
type _GuardListDyadicSecondArg = Assert<_ListDyadicMemoriesArgs[1] extends string ? true : false>;
type _GuardListDyadicThirdArg = Assert<_ListDyadicMemoriesArgs[2] extends number | undefined ? true : false>;
type _GuardListDyadicResult = Assert<IsEqual<
  _ListDyadicMemoriesResult,
  components['schemas']['AgentMemoryRecordDto'][]
>>;

type _GuardCommitMemoryFirstArg = Assert<_CommitMemoryArgs[0] extends string ? true : false>;
type _GuardCommitMemoryBody = Assert<IsEqual<
  _CommitMemoryArgs[1],
  components['schemas']['CommitAgentMemoryDto']
>>;
type _GuardCommitMemoryResult = Assert<IsEqual<
  _CommitMemoryResult,
  components['schemas']['AgentMemoryRecordDto']
>>;
type _GuardAgentMemoryRecordCommitId = Assert<IsEqual<
  components['schemas']['AgentMemoryRecordDto']['commitId'],
  string
>>;
type _GuardAgentMemoryRecordAppId = Assert<IsEqual<
  components['schemas']['AgentMemoryRecordDto']['appId'],
  string
>>;
type _GuardAgentMemoryRecordSessionId = Assert<IsEqual<
  components['schemas']['AgentMemoryRecordDto']['sessionId'],
  string
>>;
type _GuardAgentMemoryRecordEffectClass = Assert<IsEqual<
  components['schemas']['AgentMemoryRecordDto']['effectClass'],
  'MEMORY_ONLY'
>>;
type _GuardAgentMemoryRecordSchemaId = Assert<IsEqual<
  components['schemas']['AgentMemoryRecordDto']['schemaId'],
  string
>>;
type _GuardAgentMemoryRecordSchemaVersion = Assert<IsEqual<
  components['schemas']['AgentMemoryRecordDto']['schemaVersion'],
  string
>>;
type _GuardAgentMemoryRecordReason = Assert<IsEqual<
  components['schemas']['AgentMemoryRecordDto']['reason'],
  string
>>;
type _GuardAgentMemoryRecordCreatedBy = Assert<IsEqual<
  components['schemas']['AgentMemoryRecordDto']['createdBy'],
  string
>>;
type _GuardListUserProfilesResult = Assert<IsEqual<
  _ListUserProfilesResult,
  unknown
>>;

type _GuardIssueGrantBody = Assert<IsEqual<
  _IssueGrantArgs[0],
  components['schemas']['CreatorModControlGrantIssueRequestDto']
>>;
type _GuardIssueGrantResult = Assert<IsEqual<
  _IssueGrantResult,
  components['schemas']['CreatorModControlGrantIssueResponseDto']
>>;

type _GuardIssueRuntimeRealmGrantBody = Assert<IsEqual<
  _IssueRuntimeRealmGrantArgs[0],
  components['schemas']['RuntimeRealmGrantIssueRequestDto']
>>;

type _GuardIssueRuntimeRealmGrantResult = Assert<IsEqual<
  _IssueRuntimeRealmGrantResult,
  components['schemas']['RuntimeRealmGrantIssueResponseDto']
>>;

type _GuardRequestDataExportBody = Assert<IsEqual<
  _RequestDataExportArgs[0],
  components['schemas']['RequestDataExportDto']
>>;

type _GuardRequestAccountDeletionBody = Assert<IsEqual<
  _RequestAccountDeletionArgs[0],
  components['schemas']['RequestAccountDeletionDto']
>>;

type _GuardRequestDataExportResult = Assert<IsEqual<
  _RequestDataExportResult,
  unknown
>>;

type _GuardRequestAccountDeletionResult = Assert<IsEqual<
  _RequestAccountDeletionResult,
  unknown
>>;
