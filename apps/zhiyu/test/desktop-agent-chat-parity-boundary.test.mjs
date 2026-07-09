import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const productionRoot = path.join(appRoot, 'src');
const productionFilePattern = /\.(?:c|m)?(?:ts|tsx|js|jsx)$/;
const importSpecifierPattern =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

const oldProductionPaths = [
  'src/shell/agent/runtime-agent-chat.ts',
  'src/shell/agent/runtime-agent-scopes.ts',
  'src/shell/agent/route-projection.ts',
  'src/shell/agent/turn-readiness.ts',
  'src/shell/app/home-desktop-chat-shell-chrome.tsx',
];

const oldImportFragments = [
  'shell/agent/runtime-agent-chat',
  'shell/agent/runtime-agent-scopes',
  'shell/agent/route-projection',
  'shell/agent/turn-readiness',
  'shell/app/home-desktop-chat-shell-chrome',
];

const agentChatParitySourceFiles = [
  'src/shell/agent-chat/ZhiyuAgentChatSurface.tsx',
  'src/shell/agent-chat/ZhiyuAgentRightPanel.tsx',
  'src/shell/agent-chat/zhiyu-route-model-picker-provider.ts',
  'src/shell/agent-chat/ZhiyuAgentChatPieces.tsx',
  'src/shell/agent-chat/voice-capture.ts',
  'src/shell/agent-chat/voice-playback.ts',
  'src/shell/agent-chat/ZhiyuAgentChatLabels.ts',
  'src/shell/agent-chat/ZhiyuAgentPanel.tsx',
];

const liveRuntimeAcceptanceSourceFiles = [
  'test/scenario/apml.scenarios.test.mjs',
  'test/scenario/media.scenarios.test.mjs',
  'test/scenario/lifecycle.scenarios.test.mjs',
  'test/scenario/emotion.scenarios.test.mjs',
  'test/scenario/voice.scenarios.test.mjs',
  'test/scenario/run-context-helpers.mjs',
  'test/scenario/repeat-runner-helpers.mjs',
  'test/electron-live-runtime-acceptance-helpers.mjs',
  'test/electron-live-runtime-delegation-helpers.mjs',
  'src/shell/auth/electron-sdk-acceptance.ts',
];
const mediaScenarioAcceptanceSourceFiles = [
  'test/scenario/media.scenarios.test.mjs',
  'test/scenario/run-context-helpers.mjs',
  'test/scenario/repeat-runner-helpers.mjs',
];
const lifecycleScenarioAcceptanceSourceFiles = [
  'test/scenario/lifecycle.scenarios.test.mjs',
  'test/scenario/run-context-helpers.mjs',
  'test/scenario/repeat-runner-helpers.mjs',
];

test('Desktop Agent Chat hardcut removes old Zhiyu chat, binding, route, and shell paths', async () => {
  const files = await collectProductionFiles(productionRoot);
  const violations = [];

  for (const relativePath of oldProductionPaths) {
    if (existsSync(path.join(appRoot, relativePath))) {
      violations.push(`${relativePath}: old production file still exists`);
    }
  }

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relativePath = path.relative(appRoot, file).replaceAll(path.sep, '/');

    for (const specifier of importSpecifiers(source)) {
      const normalized = specifier.replaceAll('\\', '/');
      if (oldImportFragments.some((fragment) => normalized.includes(fragment))) {
        violations.push(`${relativePath}: forbidden old-path import ${specifier}`);
      }
    }

    if (/\bexport\s+\*\s+from\s+['"][^'"]*(?:runtime-agent-chat|runtime-agent-scopes|route-projection|turn-readiness|home-desktop-chat-shell-chrome)/.test(source)) {
      violations.push(`${relativePath}: forbidden forwarding export for old path`);
    }
  }

  assert.deepEqual(violations, []);
});

test('Desktop Agent Chat hardcut forbids pseudo binding proof and transcript masking helpers', async () => {
  const files = await collectProductionFiles(productionRoot);
  const violations = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relativePath = path.relative(appRoot, file).replaceAll(path.sep, '/');

    if (/\bwithZhiyuElectronRuntimeProtectedScopes\b/.test(source)) {
      violations.push(`${relativePath}: old protected scopes helper is not Runtime binding proof`);
    }
    if (/\boperation\s*\(\s*\{\s*\}\s*\)/.test(source)) {
      violations.push(`${relativePath}: empty call options are not Runtime binding proof`);
    }
    for (const helperName of [
      'productGeneratedText',
      'productSenderName',
      'productPartnerDisplayName',
      'localAgentContactSubtitle',
    ]) {
      if (new RegExp(`\\b${helperName}\\b`).test(source)) {
        violations.push(`${relativePath}: transcript masking helper ${helperName}`);
      }
    }
    if (/\bsourceWorldId\s*\?\.\s*includes\s*\(/.test(source) || /\bsourceWorldId\s*&&\s*[^;\n]*\.includes\s*\(/.test(source)) {
      violations.push(`${relativePath}: source world id substring checks are not identity/world display proof`);
    }
    if (/['"]唐代文人世界['"]/.test(source)) {
      violations.push(`${relativePath}: hardcoded world display label is not Runtime/Inventory source projection`);
    }
  }

  assert.deepEqual(violations, []);
});

test('Desktop Agent Chat hardcut does not keep a production provenance map as migration scaffolding', async () => {
  const sourceMapPath = path.join(appRoot, 'src', 'shell', 'agent-chat', 'desktop-source-map.ts');
  assert.equal(existsSync(sourceMapPath), false, `${sourceMapPath} must not remain in production source`);
});

test('Desktop Agent Chat Runtime binding host equivalence is Electron-host owned and fail-closed', async () => {
  const preloadSource = await readFile(path.join(appRoot, 'src-electron', 'preload.cts'), 'utf8');
  assert.match(preloadSource, /__nimiZhiyuRuntimeAgentBinding/);
  assert.match(preloadSource, /runtime-sdk-authority:kit-electron-runtime-bridge-local-first-party-host/);
  assert.match(preloadSource, /authority:\s*['"]runtime-sdk['"]/);
  assert.match(preloadSource, /failureSemantics:\s*['"]fail-closed['"]/);
});

test('primary agent chat surface does not import Capability Studio direct AI consume path', async () => {
  const files = await collectProductionFiles(path.join(productionRoot, 'shell'));
  const violations = [];

  for (const file of files) {
    const relativePath = path.relative(appRoot, file).replaceAll(path.sep, '/');
    if (!relativePath.includes('/agent-chat/') && !relativePath.endsWith('App.tsx')) {
      continue;
    }

    const source = await readFile(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      if (specifier.includes('capability-studio/zhiyu-ai-consume')) {
        violations.push(`${relativePath}: primary chat path imports direct AI consume helper`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('Zhiyu product shell contains no app-scope AIConfig or direct Capability Studio AI consume substrate', async () => {
  const files = [
    ...await collectProductionFiles(path.join(productionRoot, 'shell')),
    ...await collectProductionFiles(path.join(appRoot, 'src-electron')),
  ];
  const violations = [];
  const forbidden = [
    ['app-scope AIConfig service', /createZhiyuAIConfigService|createZhiyuAgentHomeAIScopeRef|loadZhiyuAIConfig|refreshZhiyuAIConfig/u],
    ['app-scope AIConfig UI', /ZhiyuAiConfigSettings|data-zhiyu-ai-config|zhiyu-agent-home/u],
    ['standard shell AIConfig facade', /NIMI_STANDARD_SHELL_COMMANDS\[['"]ai-config\.(?:get|set)['"]\]|aiConfigStore|createNimiElectronFileAIConfigStore/u],
    ['SDK AIConfig route truth type', /\bNimiAIConfig\b/u],
    ['direct Kit AI consume helper', /runRuntimeAIConsumeCapability/u],
    ['direct Runtime speech synthesize helper', /runRuntimeSpeechSynthesize/u],
    ['Capability Studio consume module', /zhiyu-ai-consume|developer-capability-studio/u],
  ];

  for (const file of files) {
    const relativePath = path.relative(appRoot, file).replaceAll(path.sep, '/');
    const source = await readFile(file, 'utf8');
    for (const [label, pattern] of forbidden) {
      if (pattern.test(source)) {
        violations.push(`${relativePath}: ${label}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('Agent Center appearance config is owned by the Kit adapter instead of a Zhiyu-only panel', async () => {
  const source = await readAgentChatSource();

  for (const marker of [
    'createAgentCenterShellAppearanceAdapter',
    'createAgentCenterShellBridge',
    'createZhiyuAgentPresentationProfileSurface',
    'appearanceAdapter={appearanceAdapter}',
    'loadSnapshot: async () => ({',
    'inspect.getPublicInspect(identity)',
  ]) {
    assert.match(source, new RegExp(escapeRegExp(marker)), `${marker} missing from Zhiyu Agent Center appearance config`);
  }

  for (const forbidden of [
    'getZhiyuAgentCenterLocalConfig',
    'putZhiyuAgentCenterLocalConfig',
    'importZhiyuAgentCenterAvatarAsset',
    'importZhiyuAgentCenterBackground',
    'importZhiyuAgentCenterLive2dAdapterManifest',
    'clearZhiyuAgentCenterAvatarAsset',
    'clearZhiyuAgentCenterBackground',
    'ZhiyuAgentCenterLocalConfig',
    '__nimiZhiyuAgentCenterLocalConfig',
    'local_avatar_asset_ref',
    'background_asset_id',
    'appearance: appearance.projection',
  ]) {
    assert.doesNotMatch(source, new RegExp(escapeRegExp(forbidden)), `${forbidden} must not remain in Zhiyu Agent Center production path`);
  }

  assert.doesNotMatch(
    source,
    /ZhiyuAgentAppearancePanel|data-zhiyu-agent-appearance-panel|data-zhiyu-avatar-import-action|data-zhiyu-live2d-workbench/,
    'Zhiyu must not keep a parallel Appearance panel inside the Kit Agent Center',
  );
  assert.doesNotMatch(
    source,
    /avatarAssetRef\s*=\s*avatar\.configurationRef|avatarAssetRef\s*=\s*avatar\.projectionRef/,
    'Zhiyu must not fabricate a local Avatar asset from Runtime projection evidence',
  );
});

test('Agent Center placement delegates section navigation to Kit instead of owning checklist actions', async () => {
  const source = await readAgentChatSource();

  assert.match(
    source,
    /@nimiplatform\/kit\/features\/agent-center/,
    'Zhiyu Agent Center placement must consume the Kit Agent Center surface',
  );
  assert.match(
    source,
    /activeSection=\{props\.activeTab\}/,
    'Zhiyu placement must pass active section into Kit Agent Center',
  );
  assert.match(
    source,
    /onSectionChange=\{props\.onActiveTabChange\}/,
    'Zhiyu placement must let Kit section buttons drive section changes',
  );
  assert.doesNotMatch(
    source,
    /zhiyu-agent-center__setup-hero/,
    'Zhiyu must not keep a parallel overview checklist inside Agent Center',
  );
});

test('streaming chat exposes a product stop control wired to the active turn abort path', async () => {
  const surfaceSource = await readFile(path.join(appRoot, 'src', 'shell', 'agent-chat', 'ZhiyuAgentChatSurface.tsx'), 'utf8');
  const appSource = await readFile(path.join(appRoot, 'src', 'shell', 'app', 'App.tsx'), 'utf8');

  for (const marker of [
    'readonly onStopChat: () => void;',
    'data-zhiyu-chat-stop-action="true"',
    'aria-label="停止当前回复"',
    'onClick={onStopChat}',
    'data-zhiyu-agent-chat-stop-state="available"',
  ]) {
    assert.match(surfaceSource, new RegExp(escapeRegExp(marker)), `${marker} missing from streaming stop UI`);
  }

  assert.match(appSource, /function handleStopChat\(\)/, 'App must expose a product stop handler');
  assert.match(appSource, /activeChatAbortRef\.current\?\.abort\('zhiyu_chat_turn_user_stopped'\)/, 'Stop handler must abort the active Runtime turn');
  assert.match(appSource, /if \(activeChatAbort\.signal\.aborted\)/, 'Aborted turns must not overwrite the user-canceled state when the Runtime promise settles');
  assert.match(appSource, /onStopChat=\{handleStopChat\}/, 'Stop handler must be passed to the agent chat surface');
});

test('Runtime action and artifact events are product-visible or explicitly deferred', async () => {
  const surfaceSource = await readAgentChatSource();
  const mediaScenarioSource = await readMediaScenarioAcceptanceSource();

  for (const marker of [
    'data-zhiyu-runtime-action-artifact-summary="true"',
    'data-zhiyu-runtime-action-count',
    'data-zhiyu-runtime-artifact-count',
    'data-zhiyu-runtime-action-artifact-preview={summary.previewState}',
    'data-zhiyu-runtime-action-artifact-preview-reason={summary.previewReason}',
    'runtime-agent-turn-artifact-ready-image-rendered',
    'zhiyu-runtime-artifact-preview-uri-not-admitted',
    'metadata?.artifacts',
  ]) {
    assert.match(`${surfaceSource}\n${mediaScenarioSource}`, new RegExp(escapeRegExp(marker)), `${marker} missing from Runtime action/artifact visible parity`);
  }

  for (const marker of [
    'B-07 image artifact renders',
    "runtimeAgentLiveE2EChatScenarioPrompt('b-image-action')",
    'artifact-ready',
    'data-zhiyu-runtime-action-artifact-summary="true"',
    'img[src^="data:image/"]',
    'captureScenarioEvidence(context',
    'scenarioEvidenceRoot',
  ]) {
    assert.match(mediaScenarioSource, new RegExp(escapeRegExp(marker)), `${marker} missing from B-07 Runtime action/artifact scenario acceptance`);
  }
});

test('live Runtime acceptance captures streaming UI before exercising stop cancel', async () => {
  const mediaScenarioSource = await readMediaScenarioAcceptanceSource();
  const streamingCaptureIndex = mediaScenarioSource.indexOf("scenarioId: `${scenarioId}-streaming`");
  const stopClickIndex = mediaScenarioSource.indexOf('await stopButton.click();');

  assert.notEqual(streamingCaptureIndex, -1, 'live Runtime acceptance must capture the active streaming UI state');
  assert.notEqual(stopClickIndex, -1, 'live Runtime acceptance must exercise the product stop action');
  assert.ok(
    streamingCaptureIndex < stopClickIndex,
    'streaming screenshot/evidence must be captured before clicking stop, otherwise U08 visual parity is unproven',
  );
});

test('live Runtime acceptance captures multi-turn transcript continuity', async () => {
  const mediaScenarioSource = await readMediaScenarioAcceptanceSource();
  const firstTurnIndex = mediaScenarioSource.indexOf("runtimeAgentLiveE2EChatScenarioPrompt('b-multi-turn-first')");
  const secondTurnIndex = mediaScenarioSource.indexOf("runtimeAgentLiveE2EChatScenarioPrompt('b-multi-turn-second')");
  const captureIndex = mediaScenarioSource.indexOf('captureScenarioEvidence(context', secondTurnIndex);

  assert.notEqual(firstTurnIndex, -1, 'live Runtime acceptance must submit the first multi-turn prompt');
  assert.notEqual(secondTurnIndex, -1, 'live Runtime acceptance must submit the second multi-turn prompt');
  assert.notEqual(captureIndex, -1, 'live Runtime acceptance must capture multi-turn continuity evidence');
  assert.ok(
    firstTurnIndex < secondTurnIndex && secondTurnIndex < captureIndex,
    'multi-turn continuity must be verified after the first and second completed turns',
  );

  for (const marker of [
    'B-02 multi-turn Runtime Agent conversation context stays on the same anchor',
    'firstOutput',
    'secondPrompt',
    'same anchor',
    'captureScenarioEvidence(context',
  ]) {
    assert.match(
      mediaScenarioSource,
      new RegExp(escapeRegExp(marker)),
      `${marker} missing from live Runtime multi-turn acceptance evidence`,
    );
  }

  assert.match(mediaScenarioSource, /notEqual\(second\.chat\.requestId,\s*first\.chat\.requestId\)/);
  assert.match(mediaScenarioSource, /second\.chat\.conversationAnchorId,\s*context\.readyEvidence\.conversation\.conversationAnchorId/);
  assert.match(mediaScenarioSource, /second\.chat\.messages\.some\(\(message\)\s*=>\s*message\?\.text\s*===\s*firstOutput\)/);
});

test('live Runtime acceptance captures restart snapshot hydration continuity', async () => {
  const lifecycleScenarioSource = await readLifecycleScenarioAcceptanceSource();
  const beforeCaptureIndex = lifecycleScenarioSource.indexOf("C-05 pre-restart completed chat");
  const restartCaptureIndex = lifecycleScenarioSource.indexOf("captureScenarioEvidence({\n          ...context,\n          page: relaunched.page");

  assert.notEqual(beforeCaptureIndex, -1, 'live Runtime acceptance must capture a completed pre-restart turn');
  assert.notEqual(restartCaptureIndex, -1, 'live Runtime acceptance must capture restart hydration evidence');
  assert.ok(
    beforeCaptureIndex < restartCaptureIndex,
    'restart hydration must be verified after transcript continuity is established',
  );

  for (const marker of [
    'C-05 app restart hydrates Runtime conversation and AI Config evidence',
    'C-05 restart hydrated Runtime Agent chat snapshot and route',
    'runtime-agent-session-snapshot-hydrated',
    'const relaunchedApp = await context.launchApp();',
    'openScenarioAppPage',
    'captureScenarioEvidence({',
  ]) {
    assert.match(
      lifecycleScenarioSource,
      new RegExp(escapeRegExp(marker)),
      `${marker} missing from live Runtime restart hydration acceptance evidence`,
    );
  }

  assert.match(lifecycleScenarioSource, /await context\.closeApp\(\);/);
  assert.match(lifecycleScenarioSource, /conversationAnchorId:\s*context\.readyEvidence\.conversation\.conversationAnchorId/);
  assert.match(lifecycleScenarioSource, /messageCount\s*>=\s*2/);
});

test('live Runtime acceptance verifies Runtime-issued delegation scoped binding renewal', async () => {
  const acceptanceSource = await readLiveRuntimeAcceptanceSource();

  for (const marker of [
    'renewDelegationScopedBinding',
    'zhiyu-runtime-agent-scoped-binding-renewed',
    'Runtime scoped binding renewal must issue a fresh binding instead of replaying the initial idempotency key',
    'renewedScopedBinding',
    'bindingSource, \'runtime-account-service\'',
    'preConfigScopedBinding.bindingId',
  ]) {
    assert.match(
      acceptanceSource,
      new RegExp(escapeRegExp(marker)),
      `${marker} missing from live Runtime scoped-binding renewal acceptance`,
    );
  }
});

test('chat voice controls project Runtime voice truth without settings-only pseudo affordances', async () => {
  const surfaceSource = await readAgentChatSource();

  for (const marker of [
    'data-zhiyu-composer-tool="voice-capture"',
    'data-zhiyu-chat-voice-capture-state={evidence.voiceCapture.state}',
    'data-zhiyu-chat-voice-capture-ready={String(evidence.voiceCapture.ready)}',
    'data-zhiyu-chat-voice-capture-reason={evidence.voiceCapture.reasonCode}',
    'data-zhiyu-chat-voice-capture-model-id={evidence.voiceCapture.runtimeBindingModelId || \'not_projected\'}',
    'data-zhiyu-composer-tool="hands-free"',
    'projectZhiyuVoicePlayback',
    'data-zhiyu-chat-voice-state={voicePlayback.state}',
    'data-zhiyu-chat-voice-reason={voicePlayback.reasonCode}',
    'data-zhiyu-chat-voice-output-mode={voicePlayback.outputMode}',
    'data-zhiyu-chat-voice-playback-state={voicePlayback.playbackState}',
    'data-zhiyu-chat-voice-audio-artifact-id={voicePlayback.audioArtifactId}',
    'data-zhiyu-chat-voice-playback-target={voicePlaybackTarget}',
    'runtime-voice-no-current-output',
    'runtime-voice-capture-ready',
    'disabled',
  ]) {
    assert.match(surfaceSource, new RegExp(escapeRegExp(marker)), `${marker} missing from Runtime voice UI`);
  }

  assert.doesNotMatch(
    surfaceSource,
    /voiceState=\{\{\s*status:\s*'idle'[\s\S]*?onToggle:\s*\(\)\s*=>\s*setRightPanelMode\('settings'\)/,
    'Chat voice must not appear as an idle interactive control that only opens settings',
  );
  assert.doesNotMatch(
    surfaceSource,
    /data-zhiyu-composer-tool="hands-free"[\s\S]{0,220}onClick=\{onOpenSettings\}/,
    'Hands-free voice tool must not be a settings-only pseudo action',
  );
  assert.doesNotMatch(
    surfaceSource,
    /data-zhiyu-composer-tool="voice-capture"[\s\S]{0,220}onClick=\{onOpenSettings\}/,
    'Voice capture tool must not be a settings-only pseudo action',
  );
});

test('Agent Center section buttons come from Kit active-page semantics', async () => {
  const surfaceSource = await readAgentChatSource();
  const kitSource = await readFile(path.join(repoRoot, 'kit', 'features', 'agent-center', 'src', 'components', 'AgentCenter.tsx'), 'utf8');

  assert.match(surfaceSource, /<AgentCenter/);
  assert.match(kitSource, /data-testid=\{`chat-agent-center-section:\$\{section\}`\}/);
  assert.match(kitSource, /aria-current=\{selected \? 'page' : undefined\}/);
  assert.match(kitSource, /aria-pressed=\{selected\}/);
});

test('Zhiyu Tailwind source scan includes Kit Agent Center utilities', async () => {
  const zhiyuStyles = await readFile(path.join(appRoot, 'src', 'styles.css'), 'utf8');
  const kitStyles = await readFile(path.join(repoRoot, 'kit', 'ui', 'src', 'styles.css'), 'utf8');

  assert.match(zhiyuStyles, /kit\/features\/agent-center\/src\/\*\*\/\*\.\{ts,tsx\}/);
  assert.match(kitStyles, /features\/agent-center\/src\/\*\*\/\*\.\{ts,tsx\}/);
});

test('Agent Center header mirrors Desktop side-sheet identity metadata', async () => {
  const surfaceSource = await readAgentChatSource();

  for (const marker of [
    'data-zhiyu-agent-center-eyebrow="agent-center"',
    'data-zhiyu-agent-center-world-name',
    'data-zhiyu-agent-center-world-icon',
    'data-zhiyu-agent-center-runtime-pill',
    'data-zhiyu-agent-center-runtime-dot',
    'data-zhiyu-agent-center-state-chip="mood"',
    'data-zhiyu-agent-center-state-chip="activity"',
    'agentCenterHeaderStateLabel(props.evidence.companion.currentEmotion)',
    'agentCenterHeaderStateLabel(props.evidence.companion.executionState)',
    'agentCenterWorldLabel(props.evidence)',
  ]) {
    assert.match(sourceWithNormalizedWhitespace(surfaceSource), new RegExp(escapeRegExp(marker)), `${marker} missing from Desktop Agent Center header metadata`);
  }

  assert.doesNotMatch(
    surfaceSource,
    /<span>\{mode === 'settings' \? '织羽设置' : '伙伴中心'\}<\/span>/,
    'Agent mode header must use the Desktop Agent Center eyebrow instead of the old Zhiyu-only label',
  );
  assert.doesNotMatch(surfaceSource, /data-zhiyu-agent-center-local-agent-ref/);
  assert.doesNotMatch(surfaceSource, /\bagentCenterLocalAgentRef\b/);
  assert.doesNotMatch(surfaceSource, /data-zhiyu-agent-center-world-chip/);
  assert.doesNotMatch(surfaceSource, /data-zhiyu-agent-center-state-chip="appearance"/);
  assert.doesNotMatch(surfaceSource, /agentCenterHeaderStateLabel\(props\.evidence\.avatar\.state\)/);
  assert.doesNotMatch(surfaceSource, />\s*世界角色\s*</u);
  assert.doesNotMatch(surfaceSource, />\s*not selected\s*</);
});

test('Agent Center model section projects Runtime AI Config and excludes Zhiyu AIConfig settings', async () => {
  const rightPanelSource = await readFile(path.join(appRoot, 'src', 'shell', 'agent-chat', 'ZhiyuAgentRightPanel.tsx'), 'utf8');
  const zhiyuRouteModelPickerProviderSource = await readFile(path.join(appRoot, 'src', 'shell', 'agent-chat', 'zhiyu-route-model-picker-provider.ts'), 'utf8');
  const kitModelSource = await readFile(path.join(repoRoot, 'kit', 'features', 'agent-center', 'src', 'components', 'AgentCenterModelSection.tsx'), 'utf8');

  assert.equal(existsSync(path.join(appRoot, 'src', 'shell', 'ai-config', 'zhiyu-ai-config-settings.tsx')), false);
  assert.equal(existsSync(path.join(appRoot, 'src', 'shell', 'ai-config', 'zhiyu-ai-config-store.ts')), false);
  assert.doesNotMatch(
    rightPanelSource,
    new RegExp(['buildZhiyu', 'AgentCenterState'].join('')),
  );
  assert.doesNotMatch(rightPanelSource, /projectZhiyuAgentCenterRuntimeProjection/);
  assert.match(rightPanelSource, /runtimeAdapter=\{runtimeAdapter\}/);
  assert.match(rightPanelSource, /modelConfig:\s*\{[\s\S]*providerResolver:\s*getZhiyuRouteModelPickerProvider/);
  assert.match(rightPanelSource, /upsertAgentAIConfig/);
  assert.match(rightPanelSource, /upsertZhiyuAgentAIConfig/);
  assert.match(rightPanelSource, /expectedRevision/);
  assert.match(rightPanelSource, /loadSnapshot/);
  assert.doesNotMatch(rightPanelSource, /agentAIConfig:\s*buildAgentAIConfig\(evidence\)/);
  assert.doesNotMatch(rightPanelSource, /readiness:\s*buildReadiness\(evidence\)/);
  assert.doesNotMatch(rightPanelSource, /function\s+build(?:AgentAIConfig|Readiness|Inspect|Appearance)/);
  assert.doesNotMatch(rightPanelSource, /ZhiyuAiConfigSettings|data-zhiyu-ai-config-embedded|modelConfigContent/);
  assert.match(zhiyuRouteModelPickerProviderSource, /createRuntimeRouteModelPickerProviderCache/);
  assert.match(zhiyuRouteModelPickerProviderSource, /listNimiRuntimeRouteOptionsWithHost/);
  assert.match(zhiyuRouteModelPickerProviderSource, /createNimiRuntimeRouteOptionsHostDeps/);
  assert.doesNotMatch(zhiyuRouteModelPickerProviderSource, /desktop-route-model-picker-provider|getDesktopRouteModelPickerProvider/);
  assert.doesNotMatch(kitModelSource, /capability\.editable \? 'Editable' : 'Read-only projection'/);
  assert.match(kitModelSource, /runtimeAdapter\.upsertAgentAIConfig/);
  assert.match(kitModelSource, /data-agent-center-model-apply/);
  assert.match(kitModelSource, /capability\.binding\?\.modelId \|\| labels\.notConfiguredLabel/);
});

test('Zhiyu presence rail does not keep migrated Desktop topbar, nav, or add chrome', async () => {
  const railSource = await readFile(path.join(appRoot, 'src', 'shell', 'agent-chat', 'ZhiyuAgentPanel.tsx'), 'utf8');

  for (const forbidden of [
    'data-zhiyu-topbar-chrome="true"',
    'data-zhiyu-topbar-notifications="true"',
    'data-zhiyu-topbar-account="true"',
    'data-zhiyu-notification-state="deferred"',
    'data-zhiyu-account-menu="true"',
    'data-zhiyu-primary-action',
    'data-zhiyu-diagnostics-entry',
    'data-zhiyu-diagnostics-toggle',
    'zhiyu-home__desktop-nav',
    'zhiyu-home__agent-bubble--add',
  ]) {
    assert.doesNotMatch(railSource, new RegExp(escapeRegExp(forbidden)), `${forbidden} must not remain in Zhiyu presence rail`);
  }

  assert.doesNotMatch(railSource, /\bBell\b/, 'Zhiyu must not keep the removed notification icon affordance');
  assert.doesNotMatch(railSource, /\bPlus\b/, 'Zhiyu must not keep the removed add-partner action chrome');
  assert.doesNotMatch(railSource, /\bMessageSquare\b|\bDatabase\b|\bImage\b|\bPanelRightOpen\b/, 'Zhiyu must not keep the deleted left navigation chrome');
  assert.match(railSource, /data-zhiyu-settings-entry="presence-rail"/, 'Presence rail must keep the Agent Center settings entry');
  assert.match(railSource, /onOpenSettings/, 'Presence rail settings must connect back to the merged Agent Center settings tab');
});

test('Desktop settings entry does not keep a second Zhiyu-only right panel implementation', async () => {
  const surfaceSource = await readAgentChatSource();

  for (const forbidden of [
    'RightSettingsPanel',
    'data-zhiyu-settings-panel="right"',
    'data-zhiyu-agent-panel-mode="settings"',
    "setRightPanelMode('settings')",
    "RightPanelMode = 'agent' | 'settings' | 'closed'",
    '偏好与后台',
    '设置项',
  ]) {
    assert.doesNotMatch(
      surfaceSource,
      new RegExp(escapeRegExp(forbidden)),
      `${forbidden} must not remain as a second Zhiyu-only settings implementation`,
    );
  }

  assert.match(
    surfaceSource,
    /const openAdvancedSettings = \(\) => \{[\s\S]{0,160}setRightPanelMode\('agent'\);[\s\S]{0,160}setActiveAgentTab\('advanced'\);[\s\S]{0,160}\};/,
    'Desktop rail settings entry must route into the merged Agent Center advanced/settings tab',
  );
  assert.match(
    surfaceSource,
    /onOpenSettings=\{openAdvancedSettings\}/,
    'Presence rail settings entry must use the merged Agent Center settings route',
  );
  assert.match(
    surfaceSource,
    /const openAppearanceConfig = \(\) => \{[\s\S]{0,160}setRightPanelMode\('agent'\);[\s\S]{0,160}setActiveAgentTab\('appearance'\);[\s\S]{0,160}\};/,
    'Avatar setup entry must route into the existing Agent Center appearance tab',
  );
  assert.match(
    surfaceSource,
    /const openBehaviorConfig = \(\) => \{[\s\S]{0,160}setRightPanelMode\('agent'\);[\s\S]{0,160}setActiveAgentTab\('behavior'\);[\s\S]{0,160}\};/,
    'Composer proactive entry must route into the existing Agent Center behavior tab',
  );
});

test('Desktop shell left rail uses migrated Nimi logo asset instead of a placeholder icon', async () => {
  const railSource = await readFile(path.join(appRoot, 'src', 'shell', 'agent-chat', 'ZhiyuAgentPanel.tsx'), 'utf8');
  const logoAssetPath = path.join(appRoot, 'src', 'shell', 'assets', 'logo.png');

  assert.equal(existsSync(logoAssetPath), true, 'Zhiyu must carry a local migrated Nimi logo PNG asset');
  assert.match(railSource, /import\s+nimiLogoImage\s+from\s+['"]\.\.\/assets\/logo\.png['"]/);
  assert.match(railSource, /data-zhiyu-desktop-logo-image="nimi"/);
  assert.match(railSource, /src=\{nimiLogoImage\}/);
  assert.doesNotMatch(
    railSource,
    /\bSparkles\b/,
    'Zhiyu Desktop shell left rail must not use a Sparkles placeholder as the brand mark',
  );
});

test('Desktop contacts rail keeps compact density inside the left presence rail', async () => {
  const railSource = await readFile(path.join(appRoot, 'src', 'shell', 'agent-chat', 'ZhiyuAgentPanel.tsx'), 'utf8');
  const css = await readFile(path.join(appRoot, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');
  const shellGridRule = lastCssRule(css, '.zhiyu-agent-chat__layout');

  assert.match(railSource, /data-zhiyu-relationship-rail-density="desktop"/);
  assert.match(railSource, /data-zhiyu-relationship-rail-source="desktop-chat-relationship-rail"/);
  assert.match(railSource, /data-zhiyu-settings-entry="presence-rail"/);
  assert.match(railSource, /className="zhiyu-agent-rail__agent-row"/);
  assert.doesNotMatch(railSource, /data-zhiyu-model-config-entry="rail"/);
  assert.doesNotMatch(railSource, /data-zhiyu-diagnostics-entry="rail"/);
  assert.doesNotMatch(railSource, /data-zhiyu-avatar-launch-entry=\{avatarLaunchAction\.state\}/);
  assert.match(shellGridRule, /grid-template-columns:\s*76px minmax\(0,\s*1fr\) 500px;/);
  assert.match(shellGridRule, /gap:\s*0;/);
  assert.doesNotMatch(css, /zhiyu-home__right-rail|zhiyu-home__desktop-nav|zhiyu-home__agents-rail|grid-template-areas:\s*"[^"]*relationship/);
  assert.match(
    css,
    /\.zhiyu-agent-rail__agent\s*\{[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px;/,
  );
  assert.match(
    css,
    /\.zhiyu-agent-rail__tools button\s*\{[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px;/,
  );
  assert.doesNotMatch(css, /\.zhiyu-agent-rail__agent\s*\{[^}]*width:\s*56px;[^}]*height:\s*56px;/);
  assert.doesNotMatch(css, /zhiyu-home__topbar-(?:chrome|button|popover)/);
  assert.doesNotMatch(css, /zhiyu-home__agent-bubble--add/);
});

test('Desktop Agent Center is closed by default and closed layout centers the chat track', async () => {
  const surfaceSource = await readAgentChatSource();
  const css = await readFile(path.join(appRoot, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');

  assert.match(
    surfaceSource,
    /const \[rightPanelMode,\s*setRightPanelMode\] = useState<RightPanelMode>\('closed'\);/,
    'Agent Center must be closed by default; explicit settings/model/avatar actions open it',
  );
  assert.match(
    css,
    /\.zhiyu-agent-chat__layout\.is-side-closed\s*\{\s*grid-template-columns:\s*76px minmax\(0,\s*1fr\);[\s\S]*grid-template-areas:\s*"presence conversation";/,
    'closed layout must only keep the presence rail and centered conversation track',
  );
  assert.doesNotMatch(
    css,
    /\.zhiyu-agent-chat__layout\.is-side-closed\s*\{[\s\S]*?grid-template-areas:\s*"presence conversation \. relationship";/,
    'closed layout must not reserve an Agent Center grid area when the panel is closed',
  );
  assert.match(
    css,
    /\.zhiyu-chat-canvas__transcript\s+\[data-canonical-transcript-width\][\s\S]*?\.zhiyu-chat-canvas__composer\s+\[data-canonical-composer-width\][\s\S]*?\{[\s\S]*?margin-right:\s*auto;[\s\S]*?margin-left:\s*auto;/,
    'closed layout must center transcript and composer content inside the conversation track',
  );
  assert.match(
    css,
    /\.zhiyu-chat-canvas__composer\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/,
    'composer container must keep the Kit canonical composer responsive inside the chat canvas',
  );
  assert.match(
    css,
    /@media \(max-width:\s*980px\)[\s\S]*?\.zhiyu-agent-chat__layout,\s*\.zhiyu-agent-chat__layout\.is-side-closed\s*\{[\s\S]*?grid-template-columns:\s*58px minmax\(0,\s*1fr\);[\s\S]*?"presence conversation"[\s\S]*?"presence side";[\s\S]*?\.zhiyu-agent-chat__layout\.is-side-closed\s*\{[\s\S]*?grid-template-areas:\s*"presence conversation";/,
    'narrow layout must keep the compact relationship rail and remove the side sheet from the closed primary grid',
  );
  assert.match(
    css,
    /@media \(max-width:\s*640px\)[\s\S]*?\.zhiyu-agent-chat__layout,\s*\.zhiyu-agent-chat__layout\.is-side-closed\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);[\s\S]*?grid-template-rows:\s*52px auto;[\s\S]*?grid-template-areas:\s*"presence"\s*"conversation";[\s\S]*?\.zhiyu-agent-chat__layout:not\(\.is-side-closed\)\s*\{[\s\S]*?grid-template-rows:\s*52px auto auto;[\s\S]*?grid-template-areas:\s*"presence"\s*"conversation"\s*"side";/,
    'phone layout must move the relationship rail above the chat canvas so the canonical composer keeps its width floor',
  );
  assert.match(
    css,
    /@media \(max-width:\s*640px\)[\s\S]*?\.zhiyu-chat-canvas\s*\{[\s\S]*?height:\s*calc\(100vh - 52px\);[\s\S]*?min-height:\s*calc\(100vh - 52px\);/,
    'phone chat canvas height must subtract the top relationship rail instead of inheriting desktop 100vh and clipping the composer',
  );
});

test('Desktop Agent Center side sheet uses Desktop shared side-sheet density', async () => {
  const surfaceSource = await readAgentChatSource();
  const css = await readFile(path.join(appRoot, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');

  assert.match(surfaceSource, /data-zhiyu-agent-center-side-sheet="desktop"/);
  assert.match(
    surfaceSource,
    /<AppCardSurface[\s\S]*?kind="promoted-glass"[\s\S]*?className="flex min-h-0 flex-1 flex-col overflow-hidden"/,
    'Agent Center must use the desktop shared promoted-glass card surface instead of a Zhiyu-only CSS shell',
  );
  assert.match(
    surfaceSource,
    /className="zhiyu-agent-center mr-2 my-12 flex h-\[calc\(100vh-96px\)\][\s\S]*?w-\[min\(500px,calc\(100vw-96px\)\)\][\s\S]*?\[grid-area:side\]/,
    'Agent Center side-sheet dimensions must live on the TSX structure that mirrors Desktop ChatSideSheet density',
  );
  assert.doesNotMatch(surfaceSource, /my-\[72px\]|h-\[calc\(100vh-144px\)\]/);
  assert.match(
    surfaceSource,
    /data-zhiyu-agent-center-kit-surface="true"/,
    'Zhiyu side sheet must host the Kit Agent Center surface instead of local tab density code',
  );
  assert.match(
    surfaceSource,
    /className="zhiyu-agent-center__body grid flex-1 content-start gap-3 overflow-auto px-5 py-3"/,
    'Agent Center body must keep the desktop sheet scroll density around the Kit surface',
  );
  assert.match(
    css,
    /\.zhiyu-agent-center > \[data-nimi-app-card-surface\]\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/,
    'Agent Center AppCardSurface must keep the desktop flex column sheet root even though nested section cards use grid',
  );
  assert.doesNotMatch(css, /\.zhiyu-agent-center__header\s*\{/);
  assert.doesNotMatch(css, /\.zhiyu-agent-center__tabs(?:\s|,|\{)/);
  assert.doesNotMatch(css, /\.zhiyu-agent-center__body\s*\{/);
  assert.match(
    css,
    /:where\(\.zhiyu-agent-chat\)\s+:where\(button\):not\(:where\(\[data-chat-agent-center="true"\],\s*\[data-chat-agent-center="true"\] \*\)\)\s*\{/,
    'Zhiyu app button defaults must not restyle nested Kit Agent Center controls',
  );
  assert.doesNotMatch(
    css,
    /:where\(\.zhiyu-agent-chat\)\s+:where\(button\)\s*\{/,
    'Unbounded Zhiyu button defaults leak app-local chrome into Kit Agent Center',
  );
  assert.match(
    css,
    /\.zhiyu-agent-center > \[data-nimi-app-card-surface\]\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/,
    'Zhiyu side sheet root keeps only the desktop flex column wrapper around the Kit Agent Center',
  );
  assert.doesNotMatch(
    css,
    /\.zhiyu-agent-center :where\(|zhiyu-agent-center__setup-hero|zhiyu-agent-center__panel-row|zhiyu-agent-center__kv-row/,
    'Zhiyu must not keep legacy Agent Center layout rules around the nested Kit surface',
  );
  assert.doesNotMatch(css, /\.zhiyu-agent-chat\s+:where\(button\)\s*\{/);
  assert.doesNotMatch(css, /\.zhiyu-agent-center__avatar\s*\{[\s\S]*?width:\s*72px;[\s\S]*?height:\s*72px;/);
});

async function collectProductionFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectProductionFiles(fullPath));
      continue;
    }
    if (entry.isFile() && productionFilePattern.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

async function readAgentChatSource() {
  return readAppFiles(agentChatParitySourceFiles);
}

async function readLiveRuntimeAcceptanceSource() {
  return readAppFiles(liveRuntimeAcceptanceSourceFiles);
}

async function readMediaScenarioAcceptanceSource() {
  return readAppFiles(mediaScenarioAcceptanceSourceFiles);
}

async function readLifecycleScenarioAcceptanceSource() {
  return readAppFiles(lifecycleScenarioAcceptanceSourceFiles);
}

async function readAppFiles(relativePaths) {
  const chunks = [];
  for (const relativePath of relativePaths) {
    chunks.push(await readFile(path.join(appRoot, relativePath), 'utf8'));
  }
  return chunks.join('\n');
}

function importSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(importSpecifierPattern)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourceWithNormalizedWhitespace(value) {
  return value.replace(/\s+/g, ' ');
}

function lastCssRule(source, selector) {
  const matches = [...source.matchAll(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, 'g'))];
  assert.ok(matches.length > 0, `${selector} rule missing`);
  return matches.at(-1)[1];
}
