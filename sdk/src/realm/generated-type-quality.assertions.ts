import type { RealmOperationResult } from './generated/operation-map.js';
import type { RealmGeneratedServiceRegistry } from './generated/service-registry.js';
import type { components } from './generated/schema.js';

type Assert<T extends true> = T;
type IsEqual<A, B> = (
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
);

type _ListCoreMemoriesArgs = Parameters<RealmGeneratedServiceRegistry['AgentsService']['agentControllerListCoreMemories']>;
type _ListE2EMemoriesArgs = Parameters<RealmGeneratedServiceRegistry['AgentsService']['agentControllerListE2EMemories']>;
type _RecallMemoriesArgs = Parameters<RealmGeneratedServiceRegistry['AgentsService']['agentControllerRecallForEntity']>;
type _IssueGrantArgs = Parameters<RealmGeneratedServiceRegistry['CreatorModsControlPlaneService']['creatorModsControllerIssueGrant']>;
type _IssueRuntimeRealmGrantArgs = Parameters<RealmGeneratedServiceRegistry['RuntimeRealmGrantsService']['issueRuntimeRealmGrant']>;
type _ListFriendsWithDetailsResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['MeService']['listMyFriendsWithDetails']>>;
type _GetCreatorAgentResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['CreatorService']['creatorControllerGetAgent']>>;
type _UpdateCreatorAgentResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['CreatorService']['creatorControllerUpdateAgent']>>;

type _ListCoreMemoriesResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['AgentsService']['agentControllerListCoreMemories']>>;
type _ListE2EMemoriesResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['AgentsService']['agentControllerListE2EMemories']>>;
type _RecallMemoriesResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['AgentsService']['agentControllerRecallForEntity']>>;
type _IssueGrantResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['CreatorModsControlPlaneService']['creatorModsControllerIssueGrant']>>;
type _IssueRuntimeRealmGrantResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['RuntimeRealmGrantsService']['issueRuntimeRealmGrant']>>;
type _GetMemoryStatsResult = RealmOperationResult<'AgentsService.agentControllerGetMemoryStats'>;
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
type _GuardWorldviewNarrativeAssets = Assert<IsEqual<
  components['schemas']['WorldviewDetailDto']['narrativeAssets'],
  components['schemas']['WorldviewNarrativeAssetsDto'] | undefined
>>;
type _GuardWorldviewVisualGuide = Assert<IsEqual<
  components['schemas']['WorldviewDetailDto']['visualGuide'],
  components['schemas']['VisualGuideDto'] | undefined
>>;
type _GuardWorldviewNarrativeHooks = Assert<IsEqual<
  components['schemas']['WorldviewDetailDto']['narrativeHooks'],
  components['schemas']['NarrativeHooksDto'] | undefined
>>;
type _GuardWorldviewPatchTimeModel = Assert<IsEqual<
  components['schemas']['WorldviewPatchDto']['timeModel'],
  components['schemas']['TimeModelDto'] | undefined
>>;
type _GuardWorldviewPatchSpaceTopology = Assert<IsEqual<
  components['schemas']['WorldviewPatchDto']['spaceTopology'],
  components['schemas']['SpaceTopologyDto'] | undefined
>>;
type _GuardWorldviewPatchCausality = Assert<IsEqual<
  components['schemas']['WorldviewPatchDto']['causality'],
  components['schemas']['CausalityModelDto'] | undefined
>>;
type _GuardWorldviewPatchCoreSystem = Assert<IsEqual<
  components['schemas']['WorldviewPatchDto']['coreSystem'],
  components['schemas']['PowerSystemDto'] | undefined
>>;
type _GuardWorldviewPatchExistences = Assert<IsEqual<
  components['schemas']['WorldviewPatchDto']['existences'],
  components['schemas']['ExistenceDefinitionDto'] | undefined
>>;
type _GuardWorldviewPatchLanguages = Assert<IsEqual<
  components['schemas']['WorldviewPatchDto']['languages'],
  components['schemas']['WorldviewLanguagesDto'] | undefined
>>;
type _GuardWorldviewPatchResources = Assert<IsEqual<
  components['schemas']['WorldviewPatchDto']['resources'],
  components['schemas']['ResourceDefinitionDto'] | undefined
>>;
type _GuardWorldviewPatchVisualGuide = Assert<IsEqual<
  components['schemas']['WorldviewPatchDto']['visualGuide'],
  components['schemas']['VisualGuideDto'] | undefined
>>;
type _GuardWorldviewPatchNarrativeHooks = Assert<IsEqual<
  components['schemas']['WorldviewPatchDto']['narrativeHooks'],
  components['schemas']['NarrativeHooksDto'] | undefined
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

type _GuardMemoryStats = Assert<IsEqual<
  components['schemas']['MemoryStatsResponseDto'],
  {
    coreCount: number;
    e2eCount: number;
    uniqueEntities: number;
  }
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

type _GuardApproveRequestDto = Assert<IsEqual<
  components['schemas']['ApproveRequestDto'],
  {
    contentText?: string;
    publishAt?: string;
  }
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

type _GuardMutationProposalDetailDto = Assert<IsEqual<
  components['schemas']['MutationProposalDetailDto']['proposedChange'],
  components['schemas']['ProposedChangeDto'][]
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

type _GuardListE2EFirstArg = Assert<_ListE2EMemoriesArgs[0] extends string ? true : false>;
type _GuardListE2ESecondArg = Assert<_ListE2EMemoriesArgs[1] extends string ? true : false>;
type _GuardListE2EThirdArg = Assert<_ListE2EMemoriesArgs[2] extends number | undefined ? true : false>;
type _GuardListE2EResult = Assert<IsEqual<
  _ListE2EMemoriesResult,
  components['schemas']['AgentMemoryRecordDto'][]
>>;

type _GuardRecallFirstArg = Assert<_RecallMemoriesArgs[0] extends string ? true : false>;
type _GuardRecallSecondArg = Assert<_RecallMemoriesArgs[1] extends string ? true : false>;
type _GuardRecallThirdArg = Assert<_RecallMemoriesArgs[2] extends number | undefined ? true : false>;
type _GuardRecallFourthArg = Assert<_RecallMemoriesArgs[3] extends string | undefined ? true : false>;
type _GuardRecallResult = Assert<IsEqual<
  _RecallMemoriesResult,
  components['schemas']['AgentMemoryRecordDto'][]
>>;

type _GuardMemoryStatsResult = Assert<IsEqual<
  _GetMemoryStatsResult,
  components['schemas']['MemoryStatsResponseDto']
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
