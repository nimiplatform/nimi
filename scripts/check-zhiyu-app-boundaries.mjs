#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const gate = process.argv[2] || '';
const sourceRoots = [
  'apps/zhiyu/src',
  'apps/zhiyu/src-electron',
  'apps/zhiyu/scripts',
];
const appShellRoots = [
  'apps/zhiyu/src',
  'apps/zhiyu/src-electron',
];
const tablesRoot = '.nimi/spec/zhiyu/kernel/tables';
const agentCenterLocalConfigHardcutFiles = new Set([
  'apps/zhiyu/src-electron/agent-center-local-config.ts',
  'apps/zhiyu/src-electron/agent-center-local-config-schema.ts',
  'apps/zhiyu/src-electron/live2d-source.ts',
]);

const gates = new Map([
  ['first-party-carrier-consumption', checkFirstPartyCarrierConsumption],
  ['sdk-kit-turn-consumption', checkSdkKitTurnConsumption],
  ['no-duplicate-turn-reducer', checkNoDuplicateTurnReducer],
  ['config-boundary', checkConfigBoundary],
  ['no-direct-ai-consumption', checkNoDirectAIConsumption],
  ['conversation-artifact-boundary', checkConversationArtifactBoundary],
  ['local-persistence-boundary', checkLocalPersistenceBoundary],
  ['agent-center-authority', checkAgentCenterAuthority],
]);

let failed = false;

function fail(message) {
  failed = true;
  console.error(`ERROR: ${message}`);
}

function abs(rel) {
  return path.join(repoRoot, rel);
}

function exists(rel) {
  return fs.existsSync(abs(rel));
}

function read(rel) {
  return fs.readFileSync(abs(rel), 'utf8');
}

function readYaml(rel) {
  return YAML.parse(read(rel));
}

function* walkFiles(rel) {
  const base = abs(rel);
  if (!fs.existsSync(base)) return;
  const stat = fs.statSync(base);
  if (stat.isFile()) {
    yield rel.replaceAll('\\', '/');
    return;
  }
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue;
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* walkFiles(child);
    } else if (entry.isFile() && /\.(?:ts|tsx|js|jsx|mjs|cjs)$/u.test(entry.name)) {
      yield child.replaceAll('\\', '/');
    }
  }
}

function lineForOffset(content, offset) {
  return content.slice(0, offset).split(/\r?\n/u).length;
}

function scan(patterns, files = sourceFiles()) {
  const hits = [];
  for (const rel of files) {
    const content = read(rel);
    for (const item of patterns) {
      const pattern = item.pattern instanceof RegExp ? item.pattern : new RegExp(escapeRegExp(item.pattern), 'u');
      for (const match of content.matchAll(new RegExp(pattern, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))) {
        hits.push({
          file: rel,
          line: lineForOffset(content, match.index || 0),
          label: item.label,
          match: match[0],
        });
      }
    }
  }
  return hits;
}

function sourceFiles() {
  return sourceRoots.flatMap((root) => [...walkFiles(root)]);
}

function appShellFiles() {
  return appShellRoots.flatMap((root) => [...walkFiles(root)]);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function reportHits(title, hits) {
  if (hits.length === 0) return;
  fail(`${title} found ${hits.length} violation(s)`);
  for (const hit of hits.slice(0, 40)) {
    console.error(`  - ${hit.file}:${hit.line} ${hit.label}: ${hit.match}`);
  }
  if (hits.length > 40) {
    console.error(`  - ... ${hits.length - 40} more violation(s)`);
  }
}

function requireFileIncludes(rel, tokens) {
  if (!exists(rel)) {
    fail(`required file is missing: ${rel}`);
    return;
  }
  const content = read(rel);
  for (const token of tokens) {
    if (!content.includes(token)) {
      fail(`${rel} must include ${token}`);
    }
  }
}

function checkFirstPartyCarrierConsumption() {
  requireFileIncludes('apps/zhiyu/src/shell/agent-chat/runtime-agent-binding.ts', [
    'resolveZhiyuRuntimeAgentBindingDecision',
    'runtime-sdk-authority-admitted-first-party-electron-host-equivalence',
    'ZHIYU_RUNTIME_AGENT_BINDING_REQUIRED',
    'x-nimi-runtime-scoped-binding-id',
    'x-nimi-runtime-host-equivalence',
  ]);
  requireFileIncludes('apps/zhiyu/src/shell/agent-chat/runtime-agent-turn-adapter.ts', [
    'createNimiRuntimeAgentTurnsModule',
    'createZhiyuRuntimeAgentBindingScopeRunner',
    'scopedBinding',
    'K-AGCORE-147',
    'conversationAnchorId',
  ]);
  const rawRuntimeTurnHits = scan([
    { label: 'raw runtime agent turn request', pattern: /runtime\.agent\.turn\.request/u },
    { label: 'raw runtime app-message send', pattern: /sendAppMessage\s*\([^)]*runtime\.agent/su },
  ]);
  reportHits('first-party carrier consumption gate', rawRuntimeTurnHits);
}

function checkSdkKitTurnConsumption() {
  requireFileIncludes('apps/zhiyu/src/shell/agent-chat/runtime-agent-turn-adapter.ts', [
    '@nimiplatform/sdk/runtime',
    '@nimiplatform/kit/features/chat/headless',
    'createNimiRuntimeAgentTurnsModule',
    'runNimiRuntimeAgentTurn',
    'streamRuntimeAgentTurnRunnerPartsAsConversationEvents',
    'reduceRuntimeAgentConversationProjectionEvent',
    'createRuntimeAgentConversationProjectionState',
  ]);
}

function checkNoDuplicateTurnReducer() {
  const hits = scan([
    { label: 'app-local runtime agent reducer', pattern: /function\s+reduceRuntimeAgent/u },
    { label: 'app-local runtime agent event stream assembler', pattern: /function\s+streamRuntimeAgentTurnRunnerParts/u },
    { label: 'app-local runtime agent projection state factory', pattern: /function\s+createRuntimeAgentConversationProjectionState/u },
    { label: 'terminal success synthesis', pattern: /reasonCode:\s*['"](?:ok|success|completed)['"]/u },
  ]);
  reportHits('no duplicate turn reducer gate', hits);
}

function checkConfigBoundary() {
  const files = [
    ...walkFiles('apps/zhiyu/src/shell/agent-chat'),
    ...walkFiles('apps/zhiyu/src/shell/ai-config'),
    ...walkFiles('apps/zhiyu/src/shell/avatar'),
    ...walkFiles('apps/zhiyu/src-electron'),
  ];
  requireFileIncludes('.nimi/spec/zhiyu/kernel/configuration-surface-contract.md', [
    'Z-CONFIG-005',
    'Retired Agent Center Local Config Bridge',
    '__nimiZhiyuAgentCenterLocalConfig',
    'Kit Shell standard `agent-center`',
    'Runtime `AgentPresentationProfile`',
  ]);
  requireFileIncludes(`${tablesRoot}/local-persistence-boundary.yaml`, [
    'agent_center_local_config_hardcut',
    'retired',
    'source_rule: Z-CONFIG-005',
  ]);
  for (const rel of [
    'apps/zhiyu/src-electron/agent-center-local-config.ts',
    'apps/zhiyu/src-electron/agent-center-local-config-schema.ts',
    'apps/zhiyu/src-electron/live2d-source.ts',
    'apps/zhiyu/src/shell/agent-chat/zhiyu-agent-center-local-config.ts',
    'apps/zhiyu/src/shell/agent-chat/zhiyu-agent-center-appearance-adapter.ts',
  ]) {
    if (exists(rel)) {
      fail(`retired Agent Center local config file must be removed: ${rel}`);
    }
  }
  const hits = scan([
    { label: 'app-local AI config store', pattern: /createNimiAIConfigStore/u },
    { label: 'app-local AI snapshot store', pattern: /createNimiAISnapshotStore/u },
    { label: 'local browser storage for AI config', pattern: /resolveBrowserStorage\s*\(\s*['"]local['"]\s*\)/u },
    { label: 'Zhiyu AI config storage key', pattern: /ZHIYU_AI_CONFIG_STORAGE_KEY/u },
    { label: 'Zhiyu AI snapshot storage key', pattern: /ZHIYU_AI_SNAPSHOT/u },
    { label: 'AI config local save API', pattern: /function\s+saveZhiyuAIConfig/u },
    { label: 'AI snapshot local record API', pattern: /function\s+recordZhiyuAISnapshot/u },
    { label: 'app-local Avatar config store', pattern: /(?:create\w*Avatar\w*Store|avatarConfigStore|avatar_configuration_store|ZHIYU_AVATAR_CONFIG_STORAGE)/u },
    { label: 'app-local Avatar resource store', pattern: /(?:avatarResourceStore|avatar_resource_store|ZHIYU_AVATAR_RESOURCE_STORAGE|live2dResourceStore|vrmResourceStore)/u },
    { label: 'Avatar browser storage truth', pattern: /(?:avatar|live2d|vrm)[\s\S]{0,80}(?:localStorage|sessionStorage|indexedDB)|(?:localStorage|sessionStorage|indexedDB)[\s\S]{0,80}(?:avatar|live2d|vrm)/iu },
    { label: 'app-local Avatar carrier lifecycle truth', pattern: /(?:carrierLifecycleStore|carrier_lifecycle_store|avatarCarrierTruth|avatar_carrier_truth)/u },
    { label: 'retired Zhiyu Agent Center local config global', pattern: /__nimiZhiyuAgentCenterLocalConfig/u },
    { label: 'retired Zhiyu Agent Center local config IPC', pattern: /zhiyu:agent-center-local-config/u },
    { label: 'retired Agent Center local config type', pattern: /\b(?:Zhiyu)?AgentCenterLocalConfig\b/u },
    { label: 'retired Agent Center local avatar ref field', pattern: /\blocal_avatar_asset_ref\b/u },
    { label: 'retired Agent Center local background field', pattern: /\bbackground_asset_id\b/u },
  ], files);
  const avatarFilesystemHits = scan([
    { label: 'Avatar filesystem truth in app shell', pattern: /(?:avatar|live2d|vrm)[\s\S]{0,120}(?:writeFile|appendFile)|(?:writeFile|appendFile)[\s\S]{0,120}(?:avatar|live2d|vrm)/iu },
  ], files.filter((rel) => !agentCenterLocalConfigHardcutFiles.has(rel)));
  reportHits('config boundary gate', [...hits, ...avatarFilesystemHits]);
}

function checkNoDirectAIConsumption() {
  const table = readYaml(`${tablesRoot}/sdk-kit-consumption-surface.yaml`);
  const symbolPatterns = (Array.isArray(table?.rows) ? table.rows : [])
    .filter((row) => row?.kind === 'forbidden_surface')
    .map((row) => String(row?.symbol || '').trim())
    .filter(Boolean)
    .filter((symbol) => !symbol.includes('sendAppMessage_to_runtime_agent_raw'))
    .map((symbol) => ({ label: `forbidden SDK/Kit surface ${symbol}`, pattern: symbol }));
  const hits = scan([
    ...symbolPatterns,
    { label: 'app-local voice render bypass', pattern: /runtime\.agent\.turn\.voice_render/u },
    { label: 'raw runtime agent app-message send', pattern: /sendAppMessage\s*\([^)]*runtime\.agent/su },
    { label: 'runtime memory write scope', pattern: /runtime\.memory\.write/u },
  ]);
  reportHits('no direct AI consumption gate', hits);
}

function checkConversationArtifactBoundary() {
  const files = sourceFiles();
  const pathHits = files
    .filter((rel) => /(?:^|\/)(?:image-studio|home-image-studio-section|image-studio-state)\b/u.test(rel))
    .map((rel) => ({ file: rel, line: 1, label: 'Zhiyu image studio surface path', match: rel }));
  const contentHits = scan([
    { label: 'direct Runtime image generation helper', pattern: /runRuntimeImageGenerate/u },
    { label: 'image studio product surface', pattern: /image-studio/u },
    { label: 'image studio surface id', pattern: /zhiyu\.image-studio\.image\.generate/u },
    { label: 'prompt-owned image generation input', pattern: /negativePrompt|promptLength/u },
  ], files);
  reportHits('conversation artifact boundary gate', [...pathHits, ...contentHits]);
}

function checkLocalPersistenceBoundary() {
  const hits = scan([
    { label: 'localStorage API', pattern: /localStorage/u },
    { label: 'sessionStorage API', pattern: /sessionStorage/u },
    { label: 'indexedDB API', pattern: /indexedDB/u },
    { label: 'local browser storage resolver', pattern: /resolveBrowserStorage\s*\(\s*['"]local['"]\s*\)/u },
    { label: 'app-local AI config store', pattern: /createNimiAIConfigStore/u },
    { label: 'app-local AI snapshot store', pattern: /createNimiAISnapshotStore/u },
    { label: 'canonical transcript persistence hint', pattern: /transcript.*(?:storage|persist|save)|(?:storage|persist|save).*transcript/iu },
  ]);
  const shellPersistenceHits = scan([
    { label: 'config truth filesystem persistence', pattern: /(?:writeFile|appendFile)[\s\S]{0,160}(?:config|aiConfig|avatarConfig|runtime_ai_config)/iu },
    { label: 'transcript truth filesystem persistence', pattern: /(?:writeFile|appendFile)[\s\S]{0,160}transcript|transcript[\s\S]{0,160}(?:writeFile|appendFile)/iu },
    { label: 'memory truth filesystem persistence', pattern: /(?:writeFile|appendFile)[\s\S]{0,160}memory|memory[\s\S]{0,160}(?:writeFile|appendFile)/iu },
    { label: 'session recovery truth filesystem persistence', pattern: /(?:writeFile|appendFile)[\s\S]{0,160}(?:session|recovery)|(?:session|recovery)[\s\S]{0,160}(?:writeFile|appendFile)/iu },
  ], appShellFiles());
  reportHits('local persistence boundary gate', [...hits, ...shellPersistenceHits]);
}

function checkAgentCenterAuthority() {
  const files = [
    ...walkFiles('apps/zhiyu/src/shell/agent-chat'),
    ...walkFiles('apps/zhiyu/src/shell/app'),
    ...walkFiles('apps/zhiyu/src-electron'),
  ].filter((rel) => exists(rel));
  requireFileIncludes('apps/zhiyu/src/shell/agent-chat/agent-ai-config.ts', [
    'runtime.agent.ai_config.read',
    'runtime.agent.ai_config.write',
    'RuntimeLocalAgentIdentityInput',
    'fetchZhiyuAgentAIConfigRouteEvidence',
    'intents',
    'zhiyu-agent-ai-config-identity-required',
  ]);
  requireFileIncludes('apps/zhiyu/src/shell/app/App.tsx', [
    'agentAIConfigRouteInputRef',
    'subscribeZhiyuAgentAIConfigReadiness(callInput)',
    'fetchZhiyuAgentAIConfigRouteEvidence(agentAIConfigRouteInputRef.current)',
  ]);
  requireFileIncludes('apps/zhiyu/src/shell/agent-chat/ZhiyuAgentRightPanel.tsx', [
    'runtimeAdapter={runtimeAdapter}',
    'upsertAgentAIConfig',
    'upsertZhiyuAgentAIConfig',
    'expectedRevision',
  ]);
  const oldExecutionSnake = ['execution', 'config'].join('_');
  const oldMemoryIntent = ['memory', 'embedding', 'intent'].join('_');
  const hits = scan([
    { label: 'old agent execution config filename', pattern: new RegExp(escapeRegExp(['agent', 'execution', 'config'].join('-')), 'u') },
    { label: 'old Zhiyu execution config commit filename', pattern: new RegExp(escapeRegExp(['zhiyu', 'execution', 'config', 'commit'].join('-')), 'u') },
    { label: 'old Runtime execution config scope', pattern: new RegExp(escapeRegExp(['runtime', 'agent', oldExecutionSnake].join('.')), 'u') },
    { label: 'old config camelCase surface', pattern: new RegExp(escapeRegExp(['execution', 'Config'].join('')), 'u') },
    { label: 'old config PascalCase type surface', pattern: new RegExp(escapeRegExp(['Execution', 'Config'].join('')), 'u') },
    { label: 'old execution-config ready reason', pattern: new RegExp(escapeRegExp(['runtime', 'execution', 'config', 'ready'].join('-')), 'u') },
    { label: 'old Zhiyu execution readiness reason', pattern: new RegExp(escapeRegExp(['zhiyu', 'agent', 'execution', 'readiness', 'unavailable'].join('-')), 'u') },
    { label: 'old execution model action', pattern: new RegExp(escapeRegExp(['configure', 'runtime', 'agent', 'execution', 'model'].join('_')), 'u') },
    { label: 'old execution readiness inspect action', pattern: new RegExp(escapeRegExp(['inspect', 'runtime', 'agent', 'execution'].join('_')), 'u') },
    { label: 'old memory embedding intent token', pattern: new RegExp(escapeRegExp(oldMemoryIntent), 'u') },
    { label: 'old memory embedding intent RPC', pattern: new RegExp(`(?:Get|Set)${escapeRegExp(['MemoryEmbedding', 'RuntimeIntent'].join(''))}`, 'u') },
    { label: 'app-local Agent Center state builder export', pattern: new RegExp(escapeRegExp(['buildZhiyu', 'AgentCenterState'].join('')), 'u') },
    { label: 'app-local Agent Center Runtime projection builder', pattern: /projectZhiyuAgentCenterRuntimeProjection/u },
    { label: 'app-local Agent Center AI Config projection builder', pattern: /function\s+buildAgentAIConfig/u },
    { label: 'app-local Agent Center readiness projection builder', pattern: /function\s+buildReadiness/u },
    { label: 'app-local Agent Center inspect projection builder', pattern: /function\s+buildInspect/u },
    { label: 'app-local Agent Center appearance projection builder', pattern: /function\s+buildAppearance/u },
    { label: 'bad mechanical runtime agentAIConfig scope', pattern: new RegExp(escapeRegExp(['runtime.agent', 'agentAIConfig'].join('.')), 'u') },
    { label: 'product direct Runtime AI consume helper', pattern: /runRuntimeAIConsumeCapability/u },
    { label: 'product direct Runtime speech synthesize helper', pattern: /runRuntimeSpeechSynthesize/u },
    { label: 'product app-scope AIConfig truth type', pattern: /\bNimiAIConfig\b/u },
    { label: 'product Electron app-scope AIConfig store', pattern: /createNimiElectronFileAIConfigStore|aiConfigStore/u },
    { label: 'standard shell app-scope AIConfig facade', pattern: /NIMI_STANDARD_SHELL_COMMANDS\[['"]ai-config\.(?:get|set)['"]\]/u },
    { label: 'Zhiyu app-scope AIConfig surface id', pattern: /zhiyu-agent-home/u },
    { label: 'Zhiyu product AIConfig settings/store module', pattern: /ZhiyuAiConfigSettings|zhiyu-ai-config-store|zhiyu-ai-config-settings/u },
    { label: 'Zhiyu product Capability Studio AI consume module', pattern: /zhiyu-ai-consume|developer-capability-studio/u },
    { label: 'Zhiyu app-specific Agent Center proposal section', pattern: /AgentCenterProposalSection/u },
    { label: 'Zhiyu app-specific Agent Center developer surface', pattern: /CapabilityStudio|technicalSurfaces|renderGatedSurface/u },
  ], files);
  reportHits('agent-center authority gate', hits);
}

if (!gates.has(gate)) {
  console.error(`Usage: node scripts/check-zhiyu-app-boundaries.mjs <${[...gates.keys()].join('|')}>`);
  process.exit(2);
}

for (const root of sourceRoots) {
  if (!exists(root)) {
    fail(`missing Zhiyu source root: ${root}`);
  }
}

if (!failed) {
  gates.get(gate)();
}

if (failed) {
  process.exit(1);
}

console.log(`zhiyu-${gate}: OK`);
