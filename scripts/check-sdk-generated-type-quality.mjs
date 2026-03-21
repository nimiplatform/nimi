import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  realmDynamicEnvelopeAllowlist,
  realmDynamicEnvelopeAllowlistPaths,
} from './sdk-realm-dynamic-envelope-allowlist.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const nimiRoot = path.resolve(scriptDir, '..');

const schemaPath = path.join(nimiRoot, 'sdk', 'src', 'realm', 'generated', 'schema.ts');
const operationMapPath = path.join(nimiRoot, 'sdk', 'src', 'realm', 'generated', 'operation-map.ts');

const schema = readFileSync(schemaPath, 'utf8');
const operationMap = readFileSync(operationMapPath, 'utf8');

const failures = [];

function expectRegex(source, regex, description) {
  if (!regex.test(source)) {
    failures.push(description);
  }
}

function extractSchemaBlock(source, schemaName) {
  const schemaMarker = `        ${schemaName}: {`;
  const startIndex = source.indexOf(schemaMarker);
  if (startIndex === -1) {
    return null;
  }

  const nextSchemaMatch = /\n {8}[A-Za-z0-9_$]+: \{/.exec(source.slice(startIndex + schemaMarker.length));
  if (!nextSchemaMatch) {
    return source.slice(startIndex);
  }

  return source.slice(startIndex, startIndex + schemaMarker.length + nextSchemaMatch.index);
}

function expectSchemaExcludesField(source, schemaName, fieldName, description) {
  const schemaBlock = extractSchemaBlock(source, schemaName);
  if (!schemaBlock) {
    failures.push(`${description} (missing schema ${schemaName})`);
    return;
  }
  if (new RegExp(`\\b${fieldName}\\??:`).test(schemaBlock)) {
    failures.push(description);
  }
}

function collectSchemaUnknownMapPaths(source) {
  const lines = source.split('\n');
  const results = [];
  let inSchemas = false;
  let currentSchema = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === 'schemas: {') {
      inSchemas = true;
      continue;
    }
    if (!inSchemas) {
      continue;
    }
    if (line.trim() === 'responses: never;') {
      break;
    }
    const schemaMatch = /^ {8}([A-Za-z0-9_$]+): \{$/.exec(line);
    if (schemaMatch) {
      currentSchema = schemaMatch[1];
      continue;
    }
    const fieldMatch = /^ {12}([^:]+): \{$/.exec(line);
    if (!currentSchema || !fieldMatch) {
      continue;
    }
    const nextLine = lines[index + 1]?.trim();
    if (nextLine === '[key: string]: unknown;') {
      results.push(`${currentSchema}.${fieldMatch[1].trim()}`);
    }
  }

  return results;
}

expectRegex(
  schema,
  /WorldDetailDto:\s*{[\s\S]*?clockConfig\?: components\["schemas"\]\["WorldClockConfigDto"\];[\s\S]*?timeModel\?: components\["schemas"\]\["TimeModelDto"\];[\s\S]*?languages\?: components\["schemas"\]\["WorldviewLanguagesDto"\];[\s\S]*?sceneTimeConfig\?: components\["schemas"\]\["SceneTimeConfigDto"\];/,
  'WorldDetailDto must expose named schemas for clockConfig/timeModel/languages/sceneTimeConfig',
);

expectRegex(
  schema,
  /WorldviewDetailDto:\s*{[\s\S]*?causality: components\["schemas"\]\["CausalityModelDto"\];[\s\S]*?coreSystem: components\["schemas"\]\["PowerSystemDto"\];[\s\S]*?languages\?: components\["schemas"\]\["WorldviewLanguagesDto"\];[\s\S]*?spaceTopology: components\["schemas"\]\["SpaceTopologyDto"\];[\s\S]*?timeModel: components\["schemas"\]\["TimeModelDto"\];/,
  'WorldviewDetailDto must expose named schemas for causality/coreSystem/languages/spaceTopology/timeModel',
);

expectRegex(
  schema,
  /WorldviewDetailDto:\s*{[\s\S]*?existences\?: components\["schemas"\]\["ExistenceDefinitionDto"\];[\s\S]*?glossary\?: components\["schemas"\]\["WorldviewGlossaryDto"\];[\s\S]*?locations\?: components\["schemas"\]\["WorldviewLocationsDto"\];[\s\S]*?narrativeAssets\?: components\["schemas"\]\["WorldviewNarrativeAssetsDto"\];[\s\S]*?narrativeHooks\?: components\["schemas"\]\["NarrativeHooksDto"\];[\s\S]*?resources\?: components\["schemas"\]\["ResourceDefinitionDto"\];[\s\S]*?visualGuide\?: components\["schemas"\]\["VisualGuideDto"\];/,
  'WorldviewDetailDto must expose named schemas for stable semantic blocks instead of unknown maps',
);

expectRegex(
  schema,
  /WorldviewPatchDto:\s*{[\s\S]*?causality\?: components\["schemas"\]\["CausalityModelDto"\];[\s\S]*?coreSystem\?: components\["schemas"\]\["PowerSystemDto"\];[\s\S]*?existences\?: components\["schemas"\]\["ExistenceDefinitionDto"\];[\s\S]*?languages\?: components\["schemas"\]\["WorldviewLanguagesDto"\];[\s\S]*?narrativeHooks\?: components\["schemas"\]\["NarrativeHooksDto"\];[\s\S]*?resources\?: components\["schemas"\]\["ResourceDefinitionDto"\];[\s\S]*?spaceTopology\?: components\["schemas"\]\["SpaceTopologyDto"\];[\s\S]*?timeModel\?: components\["schemas"\]\["TimeModelDto"\];[\s\S]*?visualGuide\?: components\["schemas"\]\["VisualGuideDto"\];/,
  'WorldviewPatchDto must keep named nested DTOs for stable worldview modules',
);

expectRegex(
  schema,
  /CausalityModelDto:\s*{[\s\S]*?fateWeight\?: number;[\s\S]*?karmaEnabled\?: boolean;[\s\S]*?type: /,
  'CausalityModelDto must expose stable karmaEnabled/fateWeight fields',
);

expectRegex(
  schema,
  /PowerSystemDto:\s*{[\s\S]*?levels\?: components\["schemas"\]\["PowerSystemLevelDto"\]\[];[\s\S]*?powerSystems\?: components\["schemas"\]\["PowerSystemDto"\]\[];[\s\S]*?taboos\?: components\["schemas"\]\["PowerSystemTabooDto"\]\[];/,
  'PowerSystemDto must expose stable levels/powerSystems/taboos fields consumed by first-party apps',
);

expectRegex(
  schema,
  /SpaceTopologyDto:\s*{[\s\S]*?realms\?: components\["schemas"\]\["SpaceRealmDto"\]\[];/,
  'SpaceTopologyDto must expose stable realms field consumed by first-party apps',
);

expectRegex(
  schema,
  /MemoryStatsResponseDto:\s*{\s*coreCount: number;\s*e2eCount: number;\s*uniqueEntities: number;\s*};/,
  'MemoryStatsResponseDto must expose its scalar fields instead of an empty object',
);

expectRegex(
  schema,
  /UserPrivateDto:\s*{[\s\S]*?giftStats\?:\s*{\s*\[key: string\]: number;\s*};/,
  'UserPrivateDto.giftStats must keep a numeric map contract instead of an empty object',
);

expectRegex(
  schema,
  /UserProfileDto:\s*{[\s\S]*?giftStats\?:\s*{\s*\[key: string\]: number;\s*};/,
  'UserProfileDto.giftStats must keep a numeric map contract instead of an empty object',
);

expectRegex(
  schema,
  /AgentProfileDto:\s*{[\s\S]*?activeWorldId\?: string;[\s\S]*?importance\?: components\["schemas"\]\["AgentImportance"\];[\s\S]*?ownerWorldId\?: string \| null;[\s\S]*?ownershipType\?: components\["schemas"\]\["AgentOwnershipType"\];[\s\S]*?state\?: components\["schemas"\]\["AgentState"\];[\s\S]*?stats\?: components\["schemas"\]\["AgentStatsDto"\];[\s\S]*?worldId\?: string;/,
  'AgentProfileDto must expose the current public agent profile shape',
);
expectSchemaExcludesField(
  schema,
  'AgentProfileDto',
  'dna',
  'AgentProfileDto must not expose public dna',
);

expectRegex(
  schema,
  /ApproveRequestDto:\s*{\s*contentText\?: string;\s*[\s\S]*?publishAt\?: string;\s*};/,
  'ApproveRequestDto must expose its request fields instead of an empty object',
);

expectRegex(
  schema,
  /CreateKeyEventDto:\s*{\s*content: string;\s*eventType: string;\s*importance\?: number;\s*userId\?: string;\s*};/,
  'CreateKeyEventDto must expose key event request fields instead of an empty object',
);

expectRegex(
  schema,
  /UserSettingsDto:\s*{[\s\S]*?notificationSettings\?: components\["schemas"\]\["UserNotificationSettingsDto"\];/,
  'UserSettingsDto.notificationSettings must use UserNotificationSettingsDto',
);

expectRegex(
  schema,
  /UpdateUserSettingsDto:\s*{[\s\S]*?notificationSettings\?: components\["schemas"\]\["UpdateUserNotificationSettingsDto"\];/,
  'UpdateUserSettingsDto.notificationSettings must use UpdateUserNotificationSettingsDto',
);

expectRegex(
  schema,
  /FriendProfileListDto:\s*{[\s\S]*?items\?: components\["schemas"\]\["FriendProfileDto"\]\[];[\s\S]*?nextCursor\?: string \| null;[\s\S]*?total\?: number;/,
  'FriendProfileListDto must stay a named app-facing response model',
);

expectRegex(
  schema,
  /UpdateCreatorAgentDto:\s*{[\s\S]*?capabilities\?: components\["schemas"\]\["UserAgentDnaDto"\];/,
  'UpdateCreatorAgentDto.capabilities must stay a named typed DTO instead of a dynamic map',
);

expectRegex(
  schema,
  /CreatorAgentResponseDto:\s*{[\s\S]*?capabilities\?: components\["schemas"\]\["UserAgentDnaDto"\];[\s\S]*?id: string;[\s\S]*?user: components\["schemas"\]\["UserLiteDto"\];/,
  'CreatorAgentResponseDto must expose named typed UserAgentDnaDto capabilities',
);

expectRegex(
  schema,
  /CreatorController_getAgent:[\s\S]*?"application\/json": components\["schemas"\]\["CreatorAgentResponseDto"\];/,
  'CreatorController_getAgent response must reference CreatorAgentResponseDto',
);

expectRegex(
  schema,
  /CreatorController_updateAgent:[\s\S]*?"application\/json": components\["schemas"\]\["CreatorAgentResponseDto"\];/,
  'CreatorController_updateAgent response must reference CreatorAgentResponseDto',
);

expectRegex(
  schema,
  /UpdateUserProfileDto:\s*{[\s\S]*?preferences\?: components\["schemas"\]\["UpdateUserProfilePreferencesDto"\];[\s\S]*?profileSummary\?: string;[\s\S]*?traits\?: components\["schemas"\]\["UpdateUserProfileTraitsDto"\];/,
  'UpdateUserProfileDto must expose its nested profile update structure',
);

expectRegex(
  schema,
  /MutationProposalDetailDto:\s*{[\s\S]*?proposedChange: components\["schemas"\]\["ProposedChangeDto"\]\[];[\s\S]*?status: "PENDING" \| "APPROVED" \| "REJECTED";/,
  'MutationProposalDetailDto.proposedChange must reference ProposedChangeDto[] instead of an empty object',
);

expectRegex(
  schema,
  /SendMessageInputDto:\s*{[\s\S]*?payload\?:\s*{\s*\[key: string\]: unknown;\s*};/,
  'SendMessageInputDto.payload must stay an explicit dynamic map instead of collapsing to an empty object',
);

expectRegex(
  schema,
  /Me2faOperationResultDto:\s*{\s*success: boolean;\s*};/,
  'Me2faOperationResultDto must expose the stable enable\/disable 2FA response contract',
);

expectRegex(
  schema,
  /ActivateAgentResultDto:\s*{[\s\S]*?state: components\["schemas"\]\["AgentState"\];[\s\S]*?success: boolean;\s*};/,
  'ActivateAgentResultDto must expose activation success and resulting state',
);

expectRegex(
  schema,
  /BatchCreateAgentsResponseDto:\s*{[\s\S]*?created: components\["schemas"\]\["BatchCreateAgentCreatedDto"\]\[];[\s\S]*?failed: components\["schemas"\]\["BatchCreateAgentFailedDto"\]\[];\s*};/,
  'BatchCreateAgentsResponseDto must remain a named creator batch response model',
);

expectRegex(
  schema,
  /UpdateAgentNsfwConsentDto:\s*{[\s\S]*?enabled: boolean;\s*};/,
  'UpdateAgentNsfwConsentDto must stay a named request DTO instead of Object',
);

expectRegex(
  schema,
  /UpdateUserNsfwConsentDto:\s*{[\s\S]*?enabled: boolean;\s*};/,
  'UpdateUserNsfwConsentDto must stay a named request DTO instead of Object',
);

expectRegex(
  schema,
  /AgentMemoryRecordDto:\s*{[\s\S]*?category: "CORE" \| "E2E";[\s\S]*?content: string;[\s\S]*?type: /,
  'AgentMemoryRecordDto must be generated for agent memory list/recall surfaces',
);

expectRegex(
  schema,
  /CreatorModControlGrantIssueResponseDto:\s*{[\s\S]*?capabilities: string\[];[\s\S]*?expiresAt: string;[\s\S]*?grantId: string;[\s\S]*?token: string;/,
  'CreatorModControlGrantIssueResponseDto must be generated for creator grant issue',
);

expectRegex(
  operationMap,
  /"AgentsService\.agentControllerListCoreMemories":[\s\S]*?"name": "limit"[\s\S]*?"valueType": "number"[\s\S]*?"hasSuccessBody": true/,
  'agentControllerListCoreMemories must keep typed limit query + success body',
);

expectRegex(
  operationMap,
  /"AgentsService\.agentControllerListE2EMemories":[\s\S]*?"name": "entityId"[\s\S]*?"name": "limit"[\s\S]*?"valueType": "number"[\s\S]*?"hasSuccessBody": true/,
  'agentControllerListE2EMemories must keep typed params + success body',
);

expectRegex(
  operationMap,
  /"AgentsService\.agentControllerRecallForEntity":[\s\S]*?"name": "query"[\s\S]*?"valueType": "string"[\s\S]*?"name": "limit"[\s\S]*?"valueType": "number"[\s\S]*?"hasSuccessBody": true/,
  'agentControllerRecallForEntity must keep typed query/limit params + success body',
);

expectRegex(
  operationMap,
  /"CreatorModsControlPlaneService\.creatorModsControllerIssueGrant":[\s\S]*?"requestBodyContentType": "application\/json"[\s\S]*?"hasSuccessBody": true/,
  'creatorModsControllerIssueGrant must keep a typed success body',
);

expectRegex(
  operationMap,
  /"MeaccountdataService\.requestDataExport":[\s\S]*?"requestBodyContentType": "application\/json"[\s\S]*?"hasSuccessBody": false/,
  'requestDataExport must expose a typed request body and no success body until the backend is implemented',
);

expectRegex(
  operationMap,
  /"MeaccountdataService\.requestAccountDeletion":[\s\S]*?"requestBodyContentType": "application\/json"[\s\S]*?"hasSuccessBody": false/,
  'requestAccountDeletion must expose a typed request body and no success body until the backend is implemented',
);

expectRegex(
  operationMap,
  /"MeService\.listMyFriendsWithDetails":[\s\S]*?"hasSuccessBody": true/,
  'listMyFriendsWithDetails must keep a typed success body',
);

expectRegex(
  operationMap,
  /"AgentsService\.agentControllerActivate":[\s\S]*?"hasBody": false[\s\S]*?"hasSuccessBody": true/,
  'agentControllerActivate must stay a body-less action endpoint with a typed success body',
);

expectRegex(
  operationMap,
  /"CreatorService\.creatorControllerBatchCreateAgents":[\s\S]*?"requestBodyContentType": "application\/json"[\s\S]*?"hasSuccessBody": true/,
  'creatorControllerBatchCreateAgents must keep a typed batch response body',
);

expectRegex(
  operationMap,
  /"AgentNsfwConsentService\.agentNsfwConsentControllerUpdateAgentConsent":[\s\S]*?"requestBodyContentType": "application\/json"[\s\S]*?"hasSuccessBody": true/,
  'agentNsfwConsentControllerUpdateAgentConsent must keep typed request and response bodies',
);

expectRegex(
  operationMap,
  /"HumanNsfwConsentService\.humanNsfwConsentControllerUpdateUserConsent":[\s\S]*?"requestBodyContentType": "application\/json"[\s\S]*?"hasSuccessBody": true/,
  'humanNsfwConsentControllerUpdateUserConsent must keep typed request and response bodies',
);

const actualDynamicEnvelopePaths = collectSchemaUnknownMapPaths(schema);
const actualDynamicEnvelopePathSet = new Set(actualDynamicEnvelopePaths);

for (const pathValue of actualDynamicEnvelopePaths) {
  if (!realmDynamicEnvelopeAllowlistPaths.has(pathValue)) {
    failures.push(`Unallowlisted realm dynamic envelope: ${pathValue}`);
  }
}

for (const entry of realmDynamicEnvelopeAllowlist) {
  if (!actualDynamicEnvelopePathSet.has(entry.path)) {
    failures.push(`Stale realm dynamic envelope allowlist entry: ${entry.path}`);
  }
}

if (failures.length > 0) {
  console.error('[check-sdk-generated-type-quality] Failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check-sdk-generated-type-quality] Passed targeted realm generated type quality checks.');
