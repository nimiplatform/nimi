#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const SDK_PACKAGE = {
  name: '@nimiplatform/sdk',
  dir: 'sdk',
};

const APP_TOOLS_PACKAGE = {
  name: '@nimiplatform/app-tools',
  dir: 'app-tools',
};

const KIT_PACKAGE = {
  name: '@nimiplatform/kit',
  dir: 'kit',
};

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

async function readPackageVersion(relativeDir) {
  const packageJsonPath = path.join(repoRoot, relativeDir, 'package.json');
  const payload = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  return String(payload.version || '').trim();
}

function tarballFileName(packageName, version) {
  const normalized = packageName.replace('@', '').replace(/\//g, '-');
  return `${normalized}-${version}.tgz`;
}

async function packPackage(packDir, pkg) {
  const version = await readPackageVersion(pkg.dir);
  runCommand('pnpm', ['--filter', pkg.name, 'pack', '--pack-destination', packDir], repoRoot);
  const tarball = path.join(packDir, tarballFileName(pkg.name, version));
  try {
    await fs.access(tarball);
  } catch {
    throw new Error(`Packed tarball not found: ${tarball}`);
  }
  return tarball;
}

async function writeConsumerPackageJson(appDir, sdkTarballPath) {
  const payload = {
    name: 'nimi-sdk-consumer-smoke',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: {
      react: '19.2.3',
      'react-dom': '19.2.3',
      i18next: '^25.8.11',
      'react-i18next': '^16.5.4',
      ai: '6.0.85',
      '@nimiplatform/sdk': `file:${sdkTarballPath}`,
    },
  };

  await fs.writeFile(path.join(appDir, 'package.json'), `${JSON.stringify(payload, null, 2)}\n`);
}

async function writeSmokeEntry(appDir) {
  const source = [
    "import { clearPlatformClient, createNimiAppRuntimePlatformClient, createPlatformClient, getPlatformClient } from '@nimiplatform/sdk';",
    "import { Runtime, buildRuntimeAuthMetadata, createRuntimeClient, createRuntimeRealmBridgeHelpers, fetchRealmGrant, normalizeRuntimeRouteSource } from '@nimiplatform/sdk/runtime';",
    "import { Realm } from '@nimiplatform/sdk/realm';",
    "import { createWorldFacade, generate as worldGenerate, fixture as worldFixture, render as worldRender, session as worldSession } from '@nimiplatform/sdk/world';",
    "import { Modal } from '@nimiplatform/sdk/runtime';",
    "import { ReasonCode } from '@nimiplatform/sdk/types';",
    "import { createScopeModule } from '@nimiplatform/sdk/scope';",
    "import * as aiApi from '@nimiplatform/sdk/ai';",
    "import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';",
    '',
    "if (typeof createPlatformClient !== 'function') throw new Error('root createPlatformClient export invalid');",
    "if (typeof createNimiAppRuntimePlatformClient !== 'function') throw new Error('root createNimiAppRuntimePlatformClient export invalid');",
    "if (typeof getPlatformClient !== 'function') throw new Error('root getPlatformClient export invalid');",
    "if (typeof clearPlatformClient !== 'function') throw new Error('root clearPlatformClient export invalid');",
    "if (typeof Runtime !== 'function') throw new Error('runtime class export invalid');",
    "if (typeof createRuntimeClient !== 'function') throw new Error('runtime client factory export invalid');",
    "if (typeof fetchRealmGrant !== 'function') throw new Error('runtime realm bridge export invalid');",
    "if (typeof createRuntimeRealmBridgeHelpers !== 'function') throw new Error('runtime realm bridge helper export invalid');",
    "if (typeof buildRuntimeAuthMetadata !== 'function') throw new Error('runtime auth metadata export invalid');",
    "if (typeof Realm !== 'function') throw new Error('realm class export invalid');",
    "if (typeof createWorldFacade !== 'function') throw new Error('world facade export invalid');",
    "if (typeof worldGenerate.project !== 'function') throw new Error('world generate export invalid');",
    "if (typeof worldFixture.normalize !== 'function') throw new Error('world fixture export invalid');",
    "if (typeof worldRender.createInspectPlan !== 'function') throw new Error('world render export invalid');",
    "if (typeof worldSession.createInspectSession !== 'function') throw new Error('world session export invalid');",
    "if (typeof createNimiAiProvider !== 'function') throw new Error('ai-provider export invalid');",
    "if (typeof aiApi.createEmptyAIConfig !== 'function') throw new Error('ai config export invalid');",
    "if (typeof aiApi.createAppAIScopeRef !== 'function') throw new Error('app ai scope export invalid');",
    "if (typeof normalizeRuntimeRouteSource !== 'function') throw new Error('runtime route export invalid');",
    "const aiScopeRef = aiApi.createAppAIScopeRef('app.nimi.sdk-smoke', 'default-surface');",
    "if (aiScopeRef.kind !== 'app' || aiScopeRef.ownerId !== 'app.nimi.sdk-smoke' || aiScopeRef.surfaceId !== 'default-surface') throw new Error('app ai scope call invalid');",
    'const emptyAIConfig = aiApi.createEmptyAIConfig(aiScopeRef);',
    "if (emptyAIConfig.scopeRef.ownerId !== 'app.nimi.sdk-smoke') throw new Error('ai config call invalid');",
    "if (normalizeRuntimeRouteSource('cloud') !== 'cloud') throw new Error('runtime route cloud call invalid');",
    "if (normalizeRuntimeRouteSource('unsupported') !== 'local') throw new Error('runtime route fallback call invalid');",
    "if ('loadStorageJsonFrom' in aiApi) throw new Error('ai storage export must not exist');",
    'try {',
    "  await import('@nimiplatform/sdk/mod');",
    "  throw new Error('retired mod subpath resolved');",
    '} catch (error) {',
    "  if (String(error?.message || error) === 'retired mod subpath resolved') throw error;",
    "  const code = String(error?.code || '');",
    "  const message = String(error?.message || error);",
    "  if (code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED' && !message.includes('not defined by \"exports\"')) throw error;",
    '}',
    "if (typeof Modal !== 'object') throw new Error('runtime export invalid');",
    'clearPlatformClient();',
    'const platformClient = await createPlatformClient({',
    "  appId: 'nimi.sdk.consumer.smoke',",
    "  realmBaseUrl: 'https://realm.nimi.ai',",
    '  allowAnonymousRealm: true,',
    '  runtimeTransport: null,',
    '});',
    "if (getPlatformClient() !== platformClient) throw new Error('platform singleton export invalid');",
    "if (platformClient.realm.baseUrl !== 'https://realm.nimi.ai') throw new Error('platform realm export invalid');",
    "if (typeof platformClient.domains.publicContent.getPublicPost !== 'function') throw new Error('platform domain export invalid');",
    "if (typeof platformClient.worldEvolution.executionEvents.read !== 'function') throw new Error('platform worldEvolution executionEvents export invalid');",
    "if (typeof platformClient.worldEvolution.commitRequests.read !== 'function') throw new Error('platform worldEvolution commitRequests export invalid');",
    'const worldFacade = createWorldFacade(platformClient);',
    "if (typeof worldFacade.generate.toRuntimeInput !== 'function') throw new Error('bound world facade export invalid');",
    "if (typeof worldFacade.truth.list !== 'function') throw new Error('bound world truth list export invalid');",
    "if (typeof worldFacade.truth.read !== 'function') throw new Error('bound world truth read export invalid');",
    "if (typeof worldFacade.truth.readDetail !== 'function') throw new Error('bound world truth detail export invalid');",
    "const worldProjection = worldGenerate.project({ textPrompt: 'Harbor district', conditioning: { type: 'image', content: { kind: 'uri', uri: 'https://example.com/reference.png' } } });",
    "if (!worldProjection.sourceModalities.includes('image')) throw new Error('world projection output invalid');",
    "const normalizedTruth = worldFacade.truth.normalize({ world: { id: 'world-1', name: 'Harbor District', description: 'Canonical harbor.', status: 'ACTIVE' }, worldview: { worldId: 'world-1', lifecycle: 'ACTIVE', version: 3, truthRules: [{ id: 'rule-1' }] } });",
    "if (normalizedTruth?.worldview?.version !== 3) throw new Error('world truth normalize output invalid');",
    'const mockWorldFacade = createWorldFacade({',
    "  appId: 'nimi.world.mock',",
    '  runtime: { media: { jobs: { submit: async (input) => input } } },',
    '  domains: {',
    '    world: {',
    "      listWorlds: async () => ([{ id: 'world-1', name: 'Harbor District', description: 'Canonical harbor.', status: 'ACTIVE', type: 'CREATOR', bannerUrl: 'https://example.com/world-1.png', computed: { score: { scoreEwma: 88 } } }]),",
    "      getWorld: async (worldId) => ({ id: worldId, name: 'Harbor District', description: 'Canonical harbor.', status: 'ACTIVE' }),",
    "      getWorldview: async (worldId) => ({ worldId, lifecycle: 'ACTIVE', version: 3, truthRules: [{ id: 'rule-1' }], languages: { languages: [{ name: 'Harbor Cant' }] } }),",
    "      getWorldDetailWithAgents: async (worldId, recommendedAgentLimit = 4) => ({ id: worldId, name: 'Harbor District', description: 'Canonical harbor.', overview: 'Layered harbor.', level: 7, agentCount: recommendedAgentLimit, status: 'ACTIVE', type: 'CREATOR', computed: { featuredAgentCount: 1, entry: { recommendedAgents: [{ id: 'agent-1', name: 'Maris', importance: 'PRIMARY' }] } } }),",
    '    },',
    '  },',
    '});',
    'const truthList = await mockWorldFacade.truth.list();',
    "if (truthList[0]?.computed?.score?.scoreEwma !== 88) throw new Error('world truth list output invalid');",
    "const truthSummary = await mockWorldFacade.truth.read('world-1');",
    "if (truthSummary.worldview?.truthRuleCount !== 1) throw new Error('world truth read output invalid');",
    "const truthDetail = await mockWorldFacade.truth.readDetail('world-1');",
    "if (truthDetail.recommendedAgents?.[0]?.name !== 'Maris') throw new Error('world truth detail output invalid');",
    'try {',
    '  platformClient.runtime.health();',
    "  throw new Error('disabled runtime should throw');",
    '} catch (error) {',
    '  const message = String(error?.message || error);',
    "  if (!message.includes('runtime is disabled')) throw error;",
    '}',
    'clearPlatformClient();',
    'const groupFetchCalls = [];',
    "const groupParticipant = { accountId: 'user-2', agentOwnerId: null, avatarUrl: null, displayName: 'Harbor Operator', handle: 'harbor-operator', isOnline: true, joinedAt: '2026-04-23T00:00:00Z', role: 'member', type: 'human' };",
    "const groupMessage = { author: { accountId: 'user-1', agentOwnerId: null, avatarUrl: null, displayName: 'Dockmaster', type: 'human' }, chatId: 'group-1', clientMessageId: 'client-1', createdAt: '2026-04-23T00:01:00Z', id: 'message-1', isRead: true, payload: { content: 'hello harbor' }, senderId: 'user-1', text: 'hello harbor', type: 'TEXT' };",
    "const groupChat = { createdAt: '2026-04-23T00:00:00Z', creatorId: 'user-1', id: 'group-1', lastMessage: groupMessage, lastMessageAt: '2026-04-23T00:01:00Z', participants: [groupParticipant], title: 'Ops Room', type: 'GROUP', unreadCount: 0, updatedAt: '2026-04-23T00:01:00Z' };",
    "const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });",
    'const noContentResponse = () => new Response(null, { status: 204 });',
    'const groupFetchImpl = async (input, init = {}) => {',
    "  const requestUrl = typeof input === 'string' ? input : input.url;",
    "  const requestMethod = typeof input === 'string' ? undefined : input.method;",
    "  const method = String(init.method || requestMethod || 'GET').toUpperCase();",
    '  const url = new URL(requestUrl);',
    "  const requestBodyText = typeof input === 'string' ? '' : await input.clone().text();",
    "  const rawBody = typeof init.body === 'string' ? init.body : (requestBodyText || null);",
    "  const body = rawBody ? JSON.parse(rawBody) : (init.body && typeof init.body === 'object' ? init.body : null);",
    '  groupFetchCalls.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams.entries()), body });',
    "  if (method === 'POST' && url.pathname === '/api/human/group-chats') return jsonResponse({ ...groupChat, title: body?.title ?? groupChat.title }, 201);",
    "  if (method === 'GET' && url.pathname === '/api/human/group-chats') return jsonResponse({ items: [groupChat], nextCursor: 'cursor-2' });",
    "  if (method === 'GET' && url.pathname === '/api/human/group-chats/group-1') return jsonResponse(groupChat);",
    "  if (method === 'PATCH' && url.pathname === '/api/human/group-chats/group-1') return jsonResponse({ ...groupChat, title: body?.title ?? groupChat.title });",
    "  if (method === 'POST' && url.pathname === '/api/human/group-chats/group-1/messages') return jsonResponse({ ...groupMessage, text: body?.text ?? groupMessage.text, payload: body?.payload ?? groupMessage.payload }, 201);",
    "  if (method === 'GET' && url.pathname === '/api/human/group-chats/group-1/messages') return jsonResponse({ items: [groupMessage], nextAfter: 'message-2', nextBefore: null });",
    "  if (method === 'PATCH' && url.pathname === '/api/human/group-chats/group-1/messages/message-1') return jsonResponse({ ...groupMessage, text: body?.text ?? 'edited harbor', editedAt: '2026-04-23T00:02:00Z' });",
    "  if (method === 'POST' && url.pathname === '/api/human/group-chats/group-1/messages/message-1/recall') return noContentResponse();",
    "  if (method === 'POST' && url.pathname === '/api/human/group-chats/group-1/participants') return jsonResponse({ ...groupParticipant, accountId: body?.accountId ?? groupParticipant.accountId }, 201);",
    "  if (method === 'PATCH' && url.pathname === '/api/human/group-chats/group-1/participants/user-2') return jsonResponse({ ...groupParticipant, accountId: 'user-2', role: body?.role ?? 'member' });",
    "  if (method === 'DELETE' && url.pathname === '/api/human/group-chats/group-1/participants/user-2') return noContentResponse();",
    "  if (method === 'POST' && url.pathname === '/api/human/group-chats/group-1/agents') return jsonResponse({ ...groupParticipant, accountId: body?.agentAccountId ?? 'agent-1', agentOwnerId: 'user-1', displayName: 'Harbor Agent', handle: 'harbor-agent', type: 'agent' }, 201);",
    "  if (method === 'DELETE' && url.pathname === '/api/human/group-chats/group-1/agents/agent-1') return noContentResponse();",
    "  if (method === 'POST' && url.pathname === '/api/human/group-chats/group-1/read') return noContentResponse();",
    "  if (method === 'GET' && url.pathname === '/api/human/group-chats/group-1/sync') return jsonResponse({ events: [{ seq: 12, type: 'message.sent', chatId: 'group-1', occurredAt: '2026-04-23T00:03:00Z', payload: { messageId: 'message-1' } }], highWatermarkSeq: 12, mode: 'delta' });",
    "  return new Response(JSON.stringify({ message: `unhandled group fetch: ${method} ${url.pathname}` }), { status: 500, headers: { 'content-type': 'application/json' } });",
    '};',
    'const findGroupCall = (method, path) => groupFetchCalls.find((entry) => entry.method === method && entry.path === path);',
    "const realm = new Realm({ baseUrl: 'https://realm.nimi.ai', auth: { mode: 'external_principal', accessToken: 'consumer-smoke-token' }, fetchImpl: groupFetchImpl });",
    "if (typeof realm.unsafeRaw?.request !== 'function') throw new Error('realm unsafeRaw request export invalid');",
    "if (typeof realm.connect !== 'function') throw new Error('realm connect export invalid');",
    "if (typeof realm.services.GroupChatsService?.listGroups !== 'function') throw new Error('realm group chat listGroups export invalid');",
    "if (typeof realm.services.GroupChatsService?.addGroupAgent !== 'function') throw new Error('realm group chat addGroupAgent export invalid');",
    "if (typeof realm.services.GroupChatsService?.removeGroupAgent !== 'function') throw new Error('realm group chat removeGroupAgent export invalid');",
    "const createdGroup = await realm.services.GroupChatsService.createGroup({ title: 'Ops Room', participantIds: ['user-2'], text: 'seed message' });",
    "if (createdGroup.type !== 'GROUP' || createdGroup.title !== 'Ops Room') throw new Error('realm createGroup contract invalid');",
    "const listedGroups = await realm.services.GroupChatsService.listGroups(20, 'cursor-1');",
    "if (listedGroups.items[0]?.id !== 'group-1' || listedGroups.nextCursor !== 'cursor-2') throw new Error('realm listGroups contract invalid');",
    "const fetchedGroup = await realm.services.GroupChatsService.getGroup('group-1');",
    "if (fetchedGroup.participants[0]?.accountId !== 'user-2') throw new Error('realm getGroup contract invalid');",
    "const updatedGroup = await realm.services.GroupChatsService.updateGroup('group-1', { title: 'Ops Room v2' });",
    "if (updatedGroup.title !== 'Ops Room v2') throw new Error('realm updateGroup contract invalid');",
    "const sentMessage = await realm.services.GroupChatsService.sendGroupMessage('group-1', { clientMessageId: 'client-1', payload: { content: 'hello harbor' }, text: 'hello harbor', type: 'TEXT' });",
    "if (sentMessage.payload?.content !== 'hello harbor') throw new Error('realm sendGroupMessage contract invalid');",
    "const listedMessages = await realm.services.GroupChatsService.listGroupMessages('group-1', 25, 'message-1');",
    "if (listedMessages.items[0]?.id !== 'message-1' || listedMessages.nextAfter !== 'message-2') throw new Error('realm listGroupMessages contract invalid');",
    "const editedMessage = await realm.services.GroupChatsService.editGroupMessage('group-1', 'message-1', { text: 'edited harbor' });",
    "if (editedMessage.text !== 'edited harbor' || !editedMessage.editedAt) throw new Error('realm editGroupMessage contract invalid');",
    "await realm.services.GroupChatsService.recallGroupMessage('group-1', 'message-1');",
    "const addedParticipant = await realm.services.GroupChatsService.addGroupParticipant('group-1', { accountId: 'user-2' });",
    "if (addedParticipant.accountId !== 'user-2' || addedParticipant.type !== 'human') throw new Error('realm addGroupParticipant contract invalid');",
    "const updatedParticipant = await realm.services.GroupChatsService.updateGroupParticipantRole('group-1', 'user-2', { role: 'admin' });",
    "if (updatedParticipant.role !== 'admin') throw new Error('realm updateGroupParticipantRole contract invalid');",
    "await realm.services.GroupChatsService.removeGroupParticipant('group-1', 'user-2');",
    "const addedAgent = await realm.services.GroupChatsService.addGroupAgent('group-1', { agentAccountId: 'agent-1' });",
    "if (addedAgent.type !== 'agent' || addedAgent.accountId !== 'agent-1') throw new Error('realm addGroupAgent contract invalid');",
    "await realm.services.GroupChatsService.removeGroupAgent('group-1', 'agent-1');",
    "await realm.services.GroupChatsService.markGroupRead('group-1');",
    "const syncedGroup = await realm.services.GroupChatsService.syncGroupEvents('group-1', 40, 12);",
    "if (syncedGroup.mode !== 'delta' || syncedGroup.highWatermarkSeq !== 12) throw new Error('realm syncGroupEvents contract invalid');",
    "if (findGroupCall('POST', '/api/human/group-chats')?.body?.participantIds?.[0] !== 'user-2' || findGroupCall('POST', '/api/human/group-chats')?.body?.text !== 'seed message') throw new Error('realm createGroup body binding invalid');",
    "if (findGroupCall('GET', '/api/human/group-chats')?.query?.cursor !== 'cursor-1') throw new Error('realm group list query binding invalid');",
    "if (findGroupCall('PATCH', '/api/human/group-chats/group-1')?.body?.title !== 'Ops Room v2') throw new Error('realm group update body binding invalid');",
    "if (findGroupCall('POST', '/api/human/group-chats/group-1/messages')?.body?.clientMessageId !== 'client-1' || findGroupCall('POST', '/api/human/group-chats/group-1/messages')?.body?.text !== 'hello harbor' || findGroupCall('POST', '/api/human/group-chats/group-1/messages')?.body?.payload?.content !== 'hello harbor') throw new Error('realm group message body binding invalid');",
    "if (findGroupCall('GET', '/api/human/group-chats/group-1/messages')?.query?.around !== 'message-1' || findGroupCall('GET', '/api/human/group-chats/group-1/messages')?.query?.limit !== '25') throw new Error('realm group message query binding invalid');",
    "if (findGroupCall('POST', '/api/human/group-chats/group-1/participants')?.body?.accountId !== 'user-2') throw new Error('realm addGroupParticipant body binding invalid');",
    "if (findGroupCall('PATCH', '/api/human/group-chats/group-1/participants/user-2')?.body?.role !== 'admin') throw new Error('realm group participant role binding invalid');",
    "if (findGroupCall('POST', '/api/human/group-chats/group-1/agents')?.body?.agentAccountId !== 'agent-1') throw new Error('realm addGroupAgent body binding invalid');",
    "if (findGroupCall('POST', '/api/human/group-chats/group-1/messages/message-1/recall')?.body !== null) throw new Error('realm group recall should not send body');",
    "if (findGroupCall('DELETE', '/api/human/group-chats/group-1/participants/user-2')?.body !== null) throw new Error('realm group participant delete should not send body');",
    "if (findGroupCall('DELETE', '/api/human/group-chats/group-1/agents/agent-1')?.body !== null) throw new Error('realm group agent delete should not send body');",
    "if (findGroupCall('POST', '/api/human/group-chats/group-1/read')?.body !== null) throw new Error('realm group read should not send body');",
    "if (findGroupCall('GET', '/api/human/group-chats/group-1/sync')?.query?.afterSeq !== '12' || findGroupCall('GET', '/api/human/group-chats/group-1/sync')?.query?.limit !== '40') throw new Error('realm group sync query binding invalid');",
    'const realmBridgeContext = {',
    "  appId: 'app.nimi.bridge',",
    '  runtime: {},',
    '  realm: {',
    '    services: {',
    '      RuntimeRealmGrantsService: {',
    "        issueRuntimeRealmGrant: async (input) => ({ token: `grant:${input.appId}`, version: 'sdk-v1', expiresAt: '2026-03-20T00:00:00Z' }),",
    '      },',
    '    },',
    '  },',
    '};',
    'const bridgedGrant = await fetchRealmGrant(realmBridgeContext, {',
    "  subjectUserId: 'user-1',",
    "  scopes: ['app.nimi.bridge.chat.read'],",
    '});',
    "if (bridgedGrant.token !== 'grant:app.nimi.bridge') throw new Error('runtime realm bridge call invalid');",
    'const bridgeHelpers = createRuntimeRealmBridgeHelpers(realmBridgeContext);',
    'const bridgeMetadata = bridgeHelpers.buildRuntimeAuthMetadata({ grantToken: bridgedGrant.token, grantVersion: bridgedGrant.version });',
    "if (bridgeMetadata.realmGrantVersion !== 'sdk-v1') throw new Error('runtime realm bridge metadata invalid');",
    "if (typeof ReasonCode !== 'object') throw new Error('types export invalid');",
    "if (typeof createScopeModule !== 'function') throw new Error('scope export invalid');",
    "console.log('sdk consumer smoke ok');",
    '',
  ].join('\n');
  await fs.writeFile(path.join(appDir, 'index.mjs'), source);
}

async function writeAuthorToolsPackageJson(appDir, appToolsTarballPath) {
  const payload = {
    name: 'nimi-author-tools-smoke',
    version: '0.0.0',
    private: true,
    type: 'module',
    devDependencies: {
      '@nimiplatform/app-tools': `file:${appToolsTarballPath}`,
      '@nimiplatform/nimi-coding': '0.2.5',
    },
  };

  await fs.writeFile(path.join(appDir, 'package.json'), `${JSON.stringify(payload, null, 2)}\n`);
}

async function rewriteGeneratedPackageJson(relativeDir, replacements) {
  const packageJsonPath = path.join(relativeDir, 'package.json');
  const payload = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  for (const [section, entries] of Object.entries(replacements)) {
    if (section === 'pnpmOverrides') {
      payload.pnpm = payload.pnpm || {};
      payload.pnpm.overrides = {
        ...(payload.pnpm.overrides || {}),
        ...entries,
      };
      continue;
    }
    if (!payload[section]) continue;
    for (const [name, version] of Object.entries(entries)) {
      if (payload[section][name] != null) {
        payload[section][name] = version;
      }
    }
  }
  await fs.writeFile(packageJsonPath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function writeTypecheckTsconfig(appDir) {
  const payload = {
    compilerOptions: {
      noEmit: true,
    },
    extends: './tsconfig.json',
  };
  await fs.writeFile(
    path.join(appDir, 'tsconfig.smoke.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-sdk-consumer-smoke-'));
  const packDir = path.join(tempRoot, 'packs');
  const appDir = path.join(tempRoot, 'app');
  const authorDir = path.join(tempRoot, 'author-tools');
  const generatedStandaloneAppDir = path.join(authorDir, 'generated-app-standalone');
  const generatedWorkspaceAppDir = path.join(authorDir, 'generated-app-workspace');
  await fs.mkdir(packDir, { recursive: true });
  await fs.mkdir(appDir, { recursive: true });
  await fs.mkdir(authorDir, { recursive: true });

  // Always build before packing so smoke validates current sources, not stale dist artifacts.
  runCommand('pnpm', ['--filter', SDK_PACKAGE.name, 'build'], repoRoot);

  const sdkTarball = await packPackage(packDir, SDK_PACKAGE);
  const appToolsTarball = await packPackage(packDir, APP_TOOLS_PACKAGE);
  const kitTarball = await packPackage(packDir, KIT_PACKAGE);

  await writeConsumerPackageJson(appDir, sdkTarball);
  await writeSmokeEntry(appDir);

  runCommand('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], appDir);
  runCommand('node', ['index.mjs'], appDir);

  await writeAuthorToolsPackageJson(authorDir, appToolsTarball);
  runCommand('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], authorDir);
  process.env.PATH = `${path.join(authorDir, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH || ''}`;
  runCommand(
    'pnpm',
    ['exec', 'nimi-app', 'create', '--dir', 'generated-app-standalone', '--profile', 'standalone'],
    authorDir,
  );
  runCommand(
    'pnpm',
    ['exec', 'nimi-app', 'create', '--dir', 'generated-app-workspace', '--profile', 'workspace-app'],
    authorDir,
  );
  for (const generatedAppDir of [generatedStandaloneAppDir, generatedWorkspaceAppDir]) {
    runCommand('pnpm', ['exec', 'nimi-app', 'init', '--dir', generatedAppDir], authorDir);
    runCommand('pnpm', ['exec', 'nimi-app', 'doctor', '--dir', generatedAppDir], authorDir);
    runCommand('pnpm', ['exec', 'nimi-app', 'update', '--dir', generatedAppDir], authorDir);
    runCommand('pnpm', ['exec', 'nimi-app', 'doctor', '--dir', generatedAppDir], authorDir);
  }

  await rewriteGeneratedPackageJson(generatedStandaloneAppDir, {
    dependencies: {
      '@nimiplatform/sdk': `file:${sdkTarball}`,
      '@nimiplatform/kit': `file:${kitTarball}`,
    },
    devDependencies: {
      '@nimiplatform/app-tools': `file:${appToolsTarball}`,
      '@nimiplatform/nimi-coding': '0.2.5',
    },
    pnpmOverrides: {
      '@nimiplatform/sdk': `file:${sdkTarball}`,
    },
  });
  await writeTypecheckTsconfig(generatedStandaloneAppDir);
  runCommand('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], generatedStandaloneAppDir);
  runCommand('pnpm', ['exec', 'tsc', '--project', 'tsconfig.smoke.json'], generatedStandaloneAppDir);

  await rewriteGeneratedPackageJson(generatedWorkspaceAppDir, {
    dependencies: {
      '@nimiplatform/sdk': `file:${sdkTarball}`,
      '@nimiplatform/kit': `file:${kitTarball}`,
    },
    devDependencies: {
      '@nimiplatform/app-tools': `file:${appToolsTarball}`,
      '@nimiplatform/nimi-coding': '0.2.5',
    },
    pnpmOverrides: {
      '@nimiplatform/sdk': `file:${sdkTarball}`,
    },
  });
  await writeTypecheckTsconfig(generatedWorkspaceAppDir);
  runCommand(
    'pnpm',
    ['install', '--ignore-scripts', '--no-frozen-lockfile'],
    generatedWorkspaceAppDir,
  );
  runCommand('pnpm', ['exec', 'tsc', '--project', 'tsconfig.smoke.json'], generatedWorkspaceAppDir);

  process.stdout.write(`[check-sdk-consumer-smoke] passed (temp=${tempRoot})\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[check-sdk-consumer-smoke] failed: ${message}\n`);
  process.exit(1);
});
